//! Размытие окон других программ (GPU DXGI Desktop Duplication + быстрый Async-GDI fallback).
//!
//! CSS `backdrop-filter` в WebView размывает только саму веб-страницу, а эффекты
//! DWM для этой задачи непригодны (на Windows 11 Acrylic превращает экран в
//! сплошную матовую «стену», BlurBehind — в чёрный прямоугольник).
//!
//! Архитектура:
//! - Выделенный фоновый поток `ScreenBlurService` (полностью спит с 0% CPU/GPU,
//!   пока `blur_active == false`).
//! - При активации блюра основной путь — **DXGI Desktop Duplication** (`IDXGIOutputDuplication`)
//!   с аппаратным уменьшением на GPU (`D3D11_RESOURCE_MISC_GENERATE_MIPS` + `GenerateMips`
//!   → чтение только mip-уровня ~`430×180`, ~300 КБ вместо 20 МБ на 3440×1440).
//! - При недоступности DXGI (RDP, UAC, HDR-поверхность, старый драйвер) автоматически
//!   переключается на **быстрый персистентный GDI** (`CreateDIBSection` + `COLORONCOLOR`,
//!   без пересоздания DC/bitmap каждый кадр) и периодически пробует вернуться на DXGI.
//! - Схема `fgcap` зарегистрирована асинхронно (`register_asynchronous_uri_scheme_protocol`)
//!   и поддерживает `?after=<seq>` → `204 No Content` при статичном экране (0 байт, 0 декодирования).
//! - Чтобы оверлей не попадал в собственный снимок, на время размытия ему ставится
//!   `WDA_EXCLUDEFROMCAPTURE`.

use std::borrow::Cow;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::thread;
use std::time::{Duration, Instant};

use tauri::http::{Request, Response, StatusCode};
use tauri::{AppHandle, Manager, UriSchemeResponder, WebviewWindow};

use crate::error::{AppError, AppResult};
use crate::overlay::{OVERLAY_LABEL, OverlayController};

/// Схема URI, по которой окно оверлея забирает снимок: `http://fgcap.localhost/frame`.
pub const CAPTURE_SCHEME: &str = "fgcap";
/// Во сколько раз уменьшается снимок по каждой оси в GDI-пути.
pub const DOWNSCALE: u32 = 6;
/// Целевой период захвата при активном блюре (~30 FPS).
const TARGET_FRAME_INTERVAL: Duration = Duration::from_millis(33);
/// Сколько держать DXGI-сессию открытой после выключения блюра (чтобы не тратить
/// время на повторную инициализацию при кратких паузах, но освобождать DWM в простое).
#[cfg(windows)]
const IDLE_RELEASE_TIMEOUT: Duration = Duration::from_secs(2);
/// Пауза перед повторной попыткой поднять DXGI после переключения на GDI fallback.
#[cfg(windows)]
const DXGI_RETRY_COOLDOWN: Duration = Duration::from_secs(5);
/// Максимальное ожидание самого первого кадра сразу после включения блюра.
const INITIAL_FRAME_WAIT: Duration = Duration::from_millis(120);

const BMP_HEADER_BYTES: usize = 54;

/// Размер уменьшенного снимка для области `width` x `height` (GDI-путь).
pub fn downscaled_size(width: u32, height: u32) -> (u32, u32) {
    ((width / DOWNSCALE).max(1), (height / DOWNSCALE).max(1))
}

/// Выбирает GPU mip-уровень для `GenerateMips`: 8× на 2K/4K/UWQHD и 4× на Full HD.
pub fn choose_mip_level(width: u32, height: u32) -> (u32, u32, u32) {
    let mip = if width >= 2000 || height >= 1400 {
        3u32
    } else if width >= 800 || height >= 600 {
        2u32
    } else {
        1u32
    };
    let dst_w = (width >> mip).max(1);
    let dst_h = (height >> mip).max(1);
    (mip, dst_w, dst_h)
}

/// Длина строки 24-битного BMP с выравниванием на 4 байта.
pub fn bmp_row_bytes(width: u32) -> usize {
    (width as usize * 3).div_ceil(4) * 4
}

/// Извлекает параметр `?after=<seq>` из URI запроса `fgcap`.
pub fn parse_after_seq(uri: &str) -> Option<u64> {
    let query = uri.split_once('?')?.1;
    for pair in query.split('&') {
        if let Some((key, val)) = pair.split_once('=')
            && key == "after"
        {
            return val.parse::<u64>().ok();
        }
    }
    None
}

/// Записывает 54-байтный заголовок 24-битного bottom-up BMP в буфер `bmp`.
fn write_bmp24_header(bmp: &mut Vec<u8>, width: u32, height: u32, pixel_bytes: usize) -> AppResult<()> {
    let too_large = || AppError::InvalidArgument("BMP image is too large".to_string());
    let file_bytes = u32::try_from(BMP_HEADER_BYTES + pixel_bytes).map_err(|_| too_large())?;
    let image_bytes = u32::try_from(pixel_bytes).map_err(|_| too_large())?;
    let width_i32 = i32::try_from(width).map_err(|_| too_large())?;
    let height_i32 = i32::try_from(height).map_err(|_| too_large())?;

    // BITMAPFILEHEADER
    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&file_bytes.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());
    bmp.extend_from_slice(&(BMP_HEADER_BYTES as u32).to_le_bytes());
    // BITMAPINFOHEADER
    bmp.extend_from_slice(&40u32.to_le_bytes());
    bmp.extend_from_slice(&width_i32.to_le_bytes());
    bmp.extend_from_slice(&height_i32.to_le_bytes());
    bmp.extend_from_slice(&1u16.to_le_bytes());
    bmp.extend_from_slice(&24u16.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());
    bmp.extend_from_slice(&image_bytes.to_le_bytes());
    bmp.extend_from_slice(&2835i32.to_le_bytes());
    bmp.extend_from_slice(&2835i32.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());
    bmp.extend_from_slice(&0u32.to_le_bytes());
    Ok(())
}

/// Собирает BMP-файл из 24-битных строк BGR, идущих снизу вверх (формат `GetDIBits` / `DIBSection`).
pub fn encode_bmp24(width: u32, height: u32, bottom_up_bgr: &[u8]) -> AppResult<Vec<u8>> {
    let pixel_bytes = bmp_row_bytes(width) * height as usize;
    if width == 0 || height == 0 || bottom_up_bgr.len() != pixel_bytes {
        return Err(AppError::InvalidArgument(format!(
            "BMP pixel buffer is {} bytes, expected {pixel_bytes} for {width}x{height}",
            bottom_up_bgr.len()
        )));
    }
    let mut bmp = Vec::with_capacity(BMP_HEADER_BYTES + pixel_bytes);
    write_bmp24_header(&mut bmp, width, height, pixel_bytes)?;
    bmp.extend_from_slice(bottom_up_bgr);
    Ok(bmp)
}

/// Конвертирует top-down BGRA-буфер (DXGI staging texture) в 24-битный bottom-up BMP за один проход.
pub fn encode_bmp24_from_bgra_top_down(
    width: u32,
    height: u32,
    bgra: &[u8],
    row_pitch: usize,
) -> AppResult<Vec<u8>> {
    let w = width as usize;
    let h = height as usize;
    if w == 0 || h == 0 {
        return Err(AppError::InvalidArgument("BMP dimensions must be non-zero".to_string()));
    }
    let min_pitch = w * 4;
    if row_pitch < min_pitch || bgra.len() < row_pitch * h {
        return Err(AppError::InvalidArgument(format!(
            "BGRA buffer too small: len={}, row_pitch={row_pitch}, need {}x{}",
            bgra.len(),
            w,
            h
        )));
    }
    let dst_row = bmp_row_bytes(width);
    let pixel_bytes = dst_row * h;
    let pad = dst_row - w * 3;
    let mut bmp = Vec::with_capacity(BMP_HEADER_BYTES + pixel_bytes);
    write_bmp24_header(&mut bmp, width, height, pixel_bytes)?;

    for y in (0..h).rev() {
        let src = &bgra[y * row_pitch..y * row_pitch + min_pitch];
        for px in src.chunks_exact(4) {
            bmp.push(px[0]); // B
            bmp.push(px[1]); // G
            bmp.push(px[2]); // R
        }
        bmp.extend(std::iter::repeat_n(0u8, pad));
    }
    Ok(bmp)
}

/// Резервное уменьшение top-down BGRA в `DOWNSCALE` раз на CPU (если драйвер не поддерживает `GenerateMips`).
pub fn encode_bmp24_from_bgra_downscaled(
    src_width: u32,
    src_height: u32,
    bgra: &[u8],
    row_pitch: usize,
) -> AppResult<Vec<u8>> {
    let sw = src_width as usize;
    let sh = src_height as usize;
    if sw == 0 || sh == 0 || row_pitch < sw * 4 || bgra.len() < row_pitch * sh {
        return Err(AppError::InvalidArgument(
            "invalid BGRA source buffer for downscale".to_string(),
        ));
    }
    let (dst_w, dst_h) = downscaled_size(src_width, src_height);
    let dw = dst_w as usize;
    let dh = dst_h as usize;
    let dst_row = bmp_row_bytes(dst_w);
    let pixel_bytes = dst_row * dh;
    let pad = dst_row - dw * 3;
    let mut bmp = Vec::with_capacity(BMP_HEADER_BYTES + pixel_bytes);
    write_bmp24_header(&mut bmp, dst_w, dst_h, pixel_bytes)?;

    let step = DOWNSCALE as usize;
    for dy in (0..dh).rev() {
        let sy = (dy * step).min(sh - 1);
        let row = &bgra[sy * row_pitch..sy * row_pitch + sw * 4];
        for dx in 0..dw {
            let sx = (dx * step).min(sw - 1) * 4;
            bmp.push(row[sx]);
            bmp.push(row[sx + 1]);
            bmp.push(row[sx + 2]);
        }
        bmp.extend(std::iter::repeat_n(0u8, pad));
    }
    Ok(bmp)
}

fn build_response(
    status: StatusCode,
    content_type: Option<&str>,
    body: Vec<u8>,
    frame_seq: Option<u64>,
    backend: Option<&str>,
) -> Response<Cow<'static, [u8]>> {
    let mut resp = Response::new(Cow::Owned(body));
    *resp.status_mut() = status;
    let headers = resp.headers_mut();
    if let Some(ct) = content_type
        && let Ok(val) = ct.parse()
    {
        headers.insert("Content-Type", val);
    }
    if let Ok(val) = "no-store".parse() {
        headers.insert("Cache-Control", val);
    }
    if let Ok(val) = "*".parse() {
        headers.insert("Access-Control-Allow-Origin", val);
    }
    if let Ok(val) = "X-Frame-Seq, X-Capture-Backend".parse() {
        headers.insert("Access-Control-Expose-Headers", val);
    }
    if let Some(seq) = frame_seq
        && let Ok(val) = seq.to_string().parse()
    {
        headers.insert("X-Frame-Seq", val);
    }
    if let Some(name) = backend
        && let Ok(val) = name.parse()
    {
        headers.insert("X-Capture-Backend", val);
    }
    resp
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CaptureRect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone)]
struct CachedFrame {
    seq: u64,
    backend: &'static str,
    bmp: Arc<Vec<u8>>,
}

struct ControlState {
    active: bool,
    rect: Option<CaptureRect>,
    shutdown: bool,
}

struct ServiceInner {
    active_flag: AtomicBool,
    control: Mutex<ControlState>,
    control_cv: Condvar,
    latest: RwLock<Option<CachedFrame>>,
    frame_ready: Mutex<u64>,
    frame_ready_cv: Condvar,
}

/// Фоновый сервис захвата экрана (DXGI Desktop Duplication на GPU + персистентный GDI fallback).
pub struct ScreenBlurService {
    inner: Arc<ServiceInner>,
}

impl Default for ScreenBlurService {
    fn default() -> Self {
        Self::new()
    }
}

impl ScreenBlurService {
    pub fn new() -> Self {
        let inner = Arc::new(ServiceInner {
            active_flag: AtomicBool::new(false),
            control: Mutex::new(ControlState {
                active: false,
                rect: None,
                shutdown: false,
            }),
            control_cv: Condvar::new(),
            latest: RwLock::new(None),
            frame_ready: Mutex::new(0),
            frame_ready_cv: Condvar::new(),
        });

        #[cfg(windows)]
        {
            let worker_inner = Arc::clone(&inner);
            if let Err(err) = thread::Builder::new()
                .name("focusglass-screen-blur".to_string())
                .spawn(move || platform::capture_worker_loop(worker_inner))
            {
                eprintln!("[FocusGlass] failed to spawn screen blur worker: {err}");
            }
        }

        Self { inner }
    }

    /// Включает или выключает фоновый захват для области оверлея.
    pub fn set_active(&self, active: bool, rect: Option<CaptureRect>) {
        self.inner.active_flag.store(active, Ordering::Release);
        if !active {
            // Сбрасываем кэш кадра, чтобы при следующем включении блюра
            // через несколько минут не мелькнул устаревший снимок экрана.
            if let Ok(mut latest) = self.inner.latest.write() {
                *latest = None;
            }
            if let Ok(mut ready) = self.inner.frame_ready.lock() {
                *ready = 0;
            }
        }
        if let Ok(mut guard) = self.inner.control.lock() {
            let changed = guard.active != active || (active && rect.is_some() && guard.rect != rect);
            guard.active = active;
            if let Some(r) = rect {
                guard.rect = Some(r);
            }
            if changed {
                self.inner.control_cv.notify_one();
            }
        }
    }

    /// Быстрое чтение последнего готового кадра без блокировки.
    fn latest_frame(&self) -> Option<CachedFrame> {
        self.inner.latest.read().ok().and_then(|g| g.clone())
    }

    /// Ждёт появления хотя бы одного кадра (вызывается на фоновом пуле только при самом старте блюра).
    fn wait_for_frame(&self, timeout: Duration) -> Option<CachedFrame> {
        if let Some(frame) = self.latest_frame() {
            return Some(frame);
        }
        let deadline = Instant::now() + timeout;
        let Ok(mut guard) = self.inner.frame_ready.lock() else {
            return None;
        };
        while *guard == 0 && self.inner.active_flag.load(Ordering::Acquire) {
            let remaining = deadline.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                break;
            }
            match self.inner.frame_ready_cv.wait_timeout(guard, remaining) {
                Ok((next_guard, wait_res)) => {
                    guard = next_guard;
                    if wait_res.timed_out() {
                        break;
                    }
                }
                Err(_) => return None,
            }
        }
        drop(guard);
        self.latest_frame()
    }
}

impl Drop for ScreenBlurService {
    fn drop(&mut self) {
        self.inner.active_flag.store(false, Ordering::Release);
        if let Ok(mut guard) = self.inner.control.lock() {
            guard.active = false;
            guard.shutdown = true;
            self.inner.control_cv.notify_all();
        }
    }
}

/// Асинхронный обработчик схемы `fgcap`: никогда не блокирует UI-поток WebView2.
pub fn handle_capture_request_async(
    app: AppHandle,
    webview_label: &str,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    if webview_label != OVERLAY_LABEL {
        responder.respond(build_response(
            StatusCode::FORBIDDEN,
            Some("text/plain"),
            b"forbidden".to_vec(),
            None,
            None,
        ));
        return;
    }

    let blur_active = app
        .try_state::<OverlayController>()
        .and_then(|controller| controller.with(|state| state.blur_active).ok())
        .unwrap_or(false);
    if !blur_active {
        responder.respond(build_response(
            StatusCode::CONFLICT,
            Some("text/plain"),
            b"blur is not active".to_vec(),
            None,
            None,
        ));
        return;
    }

    let after_seq = parse_after_seq(&request.uri().to_string());
    let Some(service) = app.try_state::<Arc<ScreenBlurService>>() else {
        responder.respond(build_response(
            StatusCode::SERVICE_UNAVAILABLE,
            Some("text/plain"),
            b"screen blur service unavailable".to_vec(),
            None,
            None,
        ));
        return;
    };

    // Быстрый путь (99.9% запросов): кадр уже готов в памяти — отвечаем за < 0.05 мс.
    if let Some(frame) = service.latest_frame() {
        respond_with_frame(frame, after_seq, responder);
        return;
    }

    // Самый первый запрос сразу после включения блюра: ждём кадр вне UI-потока.
    let svc = Arc::clone(service.inner());
    tauri::async_runtime::spawn_blocking(move || match svc.wait_for_frame(INITIAL_FRAME_WAIT) {
        Some(frame) => respond_with_frame(frame, after_seq, responder),
        None => responder.respond(build_response(
            StatusCode::NO_CONTENT,
            None,
            Vec::new(),
            None,
            None,
        )),
    });
}

fn respond_with_frame(
    frame: CachedFrame,
    after_seq: Option<u64>,
    responder: UriSchemeResponder,
) {
    if after_seq == Some(frame.seq) {
        responder.respond(build_response(
            StatusCode::NO_CONTENT,
            None,
            Vec::new(),
            Some(frame.seq),
            Some(frame.backend),
        ));
        return;
    }
    responder.respond(build_response(
        StatusCode::OK,
        Some("image/bmp"),
        (*frame.bmp).clone(),
        Some(frame.seq),
        Some(frame.backend),
    ));
}

/// Читает физический прямоугольник окна оверлея для захвата.
pub fn overlay_capture_rect(window: &WebviewWindow) -> Option<CaptureRect> {
    let origin = window.outer_position().ok()?;
    let size = window.outer_size().ok()?;
    if size.width == 0 || size.height == 0 {
        return None;
    }
    Some(CaptureRect {
        x: origin.x,
        y: origin.y,
        width: size.width,
        height: size.height,
    })
}

/// Исключает окно из захвата экрана (или возвращает обратно).
pub fn set_capture_exclusion(window: &WebviewWindow, excluded: bool) -> AppResult<()> {
    platform::set_capture_exclusion(window, excluded)
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::sync::Arc;
    use std::thread;
    use std::time::{Duration, Instant};

    use tauri::WebviewWindow;
    use windows::Win32::Foundation::HMODULE;
    use windows::Win32::Graphics::Direct3D::{
        D3D_DRIVER_TYPE_HARDWARE, D3D_DRIVER_TYPE_UNKNOWN, D3D_FEATURE_LEVEL_11_0,
    };
    use windows::Win32::Graphics::Direct3D11::{
        D3D11_BIND_RENDER_TARGET, D3D11_BIND_SHADER_RESOURCE, D3D11_CPU_ACCESS_READ,
        D3D11_CREATE_DEVICE_BGRA_SUPPORT, D3D11_FORMAT_SUPPORT_MIP_AUTOGEN, D3D11_MAP_READ,
        D3D11_MAPPED_SUBRESOURCE, D3D11_RESOURCE_MISC_GENERATE_MIPS, D3D11_SDK_VERSION,
        D3D11_TEXTURE2D_DESC, D3D11_USAGE_DEFAULT, D3D11_USAGE_STAGING, D3D11CreateDevice,
        ID3D11Device, ID3D11DeviceContext, ID3D11Resource, ID3D11ShaderResourceView,
        ID3D11Texture2D,
    };
    use windows::Win32::Graphics::Dxgi::Common::{
        DXGI_FORMAT_B8G8R8A8_UNORM, DXGI_FORMAT_B8G8R8A8_UNORM_SRGB, DXGI_SAMPLE_DESC,
    };
    use windows::Win32::Graphics::Dxgi::{
        CreateDXGIFactory1, DXGI_ERROR_ACCESS_LOST, DXGI_ERROR_NOT_FOUND, DXGI_ERROR_WAIT_TIMEOUT,
        DXGI_OUTDUPL_FRAME_INFO, IDXGIAdapter, IDXGIAdapter1, IDXGIFactory1, IDXGIOutput1,
        IDXGIOutputDuplication,
    };
    use windows::Win32::Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, COLORONCOLOR, CreateCompatibleDC, CreateDIBSection,
        DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, HBITMAP, HDC, HGDIOBJ, ReleaseDC, SRCCOPY,
        SelectObject, SetStretchBltMode, StretchBlt,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };
    use windows::core::Interface;

    use super::{
        CachedFrame, CaptureRect, DXGI_RETRY_COOLDOWN, IDLE_RELEASE_TIMEOUT, ServiceInner,
        TARGET_FRAME_INTERVAL, bmp_row_bytes, choose_mip_level, downscaled_size, encode_bmp24,
        encode_bmp24_from_bgra_downscaled, encode_bmp24_from_bgra_top_down,
    };
    use crate::error::{AppError, AppResult};

    enum CaptureStep {
        NewFrame(Vec<u8>),
        Unchanged,
    }

    struct DxgiTargets {
        src_width: u32,
        src_height: u32,
        target_mip: u32,
        dst_width: u32,
        dst_height: u32,
        mip_res: Option<ID3D11Resource>,
        mip_srv: Option<ID3D11ShaderResourceView>,
        staging_res: ID3D11Resource,
    }

    /// Аппаратный захват экрана через DXGI Desktop Duplication + GPU `GenerateMips`.
    struct DxgiCapturer {
        device: ID3D11Device,
        context: ID3D11DeviceContext,
        duplication: IDXGIOutputDuplication,
        supports_mip_autogen: bool,
        targets: Option<DxgiTargets>,
        has_presented_once: bool,
        rect: CaptureRect,
    }

    impl DxgiCapturer {
        fn new(rect: CaptureRect) -> AppResult<Self> {
            unsafe {
                let factory: IDXGIFactory1 = CreateDXGIFactory1()
                    .map_err(|e| AppError::Io(std::io::Error::other(format!("DXGI factory: {e}"))))?;

                let mut matched: Option<(IDXGIAdapter1, IDXGIOutput1)> = None;
                let mut fallback: Option<(IDXGIAdapter1, IDXGIOutput1)> = None;
                let center_x = rect.x.saturating_add((rect.width / 2) as i32);
                let center_y = rect.y.saturating_add((rect.height / 2) as i32);

                let mut adapter_idx = 0u32;
                loop {
                    let adapter = match factory.EnumAdapters1(adapter_idx) {
                        Ok(a) => a,
                        Err(e) if e.code() == DXGI_ERROR_NOT_FOUND => break,
                        Err(_) => break,
                    };
                    adapter_idx += 1;

                    let mut out_idx = 0u32;
                    loop {
                        let output = match adapter.EnumOutputs(out_idx) {
                            Ok(o) => o,
                            Err(e) if e.code() == DXGI_ERROR_NOT_FOUND => break,
                            Err(_) => break,
                        };
                        out_idx += 1;

                        let Ok(desc) = output.GetDesc() else {
                            continue;
                        };
                        let Ok(output1) = output.cast::<IDXGIOutput1>() else {
                            continue;
                        };
                        let r = desc.DesktopCoordinates;
                        if fallback.is_none() {
                            fallback = Some((adapter.clone(), output1.clone()));
                        }
                        if center_x >= r.left
                            && center_x < r.right
                            && center_y >= r.top
                            && center_y < r.bottom
                        {
                            matched = Some((adapter.clone(), output1));
                            break;
                        }
                    }
                    if matched.is_some() {
                        break;
                    }
                }

                let (adapter1, output1) = matched.or(fallback).ok_or_else(|| {
                    AppError::Io(std::io::Error::other("DXGI: no desktop output found"))
                })?;

                let adapter_base: IDXGIAdapter = adapter1.cast().map_err(|e| {
                    AppError::Io(std::io::Error::other(format!("DXGI adapter cast: {e}")))
                })?;
                let feature_levels = [D3D_FEATURE_LEVEL_11_0];
                let mut device = None;
                let mut context = None;

                // При переданном адаптере драйвер обязан быть D3D_DRIVER_TYPE_UNKNOWN.
                let created = D3D11CreateDevice(
                    Some(&adapter_base),
                    D3D_DRIVER_TYPE_UNKNOWN,
                    HMODULE::default(),
                    D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                    Some(&feature_levels),
                    D3D11_SDK_VERSION,
                    Some(&mut device),
                    None,
                    Some(&mut context),
                )
                .or_else(|_| {
                    D3D11CreateDevice(
                        None,
                        D3D_DRIVER_TYPE_HARDWARE,
                        HMODULE::default(),
                        D3D11_CREATE_DEVICE_BGRA_SUPPORT,
                        Some(&feature_levels),
                        D3D11_SDK_VERSION,
                        Some(&mut device),
                        None,
                        Some(&mut context),
                    )
                });
                created.map_err(|e| {
                    AppError::Io(std::io::Error::other(format!("D3D11CreateDevice: {e}")))
                })?;

                let device = device.ok_or_else(|| {
                    AppError::Io(std::io::Error::other("D3D11CreateDevice returned null device"))
                })?;
                let context = context.ok_or_else(|| {
                    AppError::Io(std::io::Error::other("D3D11CreateDevice returned null context"))
                })?;

                let duplication = output1.DuplicateOutput(&device).map_err(|e| {
                    AppError::Io(std::io::Error::other(format!("DuplicateOutput: {e}")))
                })?;

                let supports_mip_autogen = device
                    .CheckFormatSupport(DXGI_FORMAT_B8G8R8A8_UNORM)
                    .map(|flags| (flags & (D3D11_FORMAT_SUPPORT_MIP_AUTOGEN.0 as u32)) != 0)
                    .unwrap_or(false);

                Ok(Self {
                    device,
                    context,
                    duplication,
                    supports_mip_autogen,
                    targets: None,
                    has_presented_once: false,
                    rect,
                })
            }
        }

        fn ensure_targets(&mut self, src_w: u32, src_h: u32) -> AppResult<&DxgiTargets> {
            let needs_recreate = self
                .targets
                .as_ref()
                .is_none_or(|t| t.src_width != src_w || t.src_height != src_h);
            if needs_recreate {
                self.targets = Some(self.create_targets(src_w, src_h)?);
            }
            self.targets.as_ref().ok_or_else(|| {
                AppError::Io(std::io::Error::other("DXGI targets unavailable"))
            })
        }

        fn create_targets(&self, src_w: u32, src_h: u32) -> AppResult<DxgiTargets> {
            unsafe {
                if self.supports_mip_autogen {
                    let (target_mip, dst_w, dst_h) = choose_mip_level(src_w, src_h);
                    let mip_desc = D3D11_TEXTURE2D_DESC {
                        Width: src_w,
                        Height: src_h,
                        MipLevels: target_mip + 1,
                        ArraySize: 1,
                        Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                        SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                        Usage: D3D11_USAGE_DEFAULT,
                        BindFlags: (D3D11_BIND_SHADER_RESOURCE.0 | D3D11_BIND_RENDER_TARGET.0)
                            as u32,
                        CPUAccessFlags: 0,
                        MiscFlags: D3D11_RESOURCE_MISC_GENERATE_MIPS.0 as u32,
                    };
                    let mut mip_tex = None;
                    if self
                        .device
                        .CreateTexture2D(&mip_desc, None, Some(&mut mip_tex))
                        .is_ok()
                        && let Some(mip_tex) = mip_tex
                    {
                        let mut mip_srv = None;
                        if self
                            .device
                            .CreateShaderResourceView(&mip_tex, None, Some(&mut mip_srv))
                            .is_ok()
                            && let Some(mip_srv) = mip_srv
                            && let Ok(mip_res) = mip_tex.cast::<ID3D11Resource>()
                        {
                            let staging_desc = D3D11_TEXTURE2D_DESC {
                                Width: dst_w,
                                Height: dst_h,
                                MipLevels: 1,
                                ArraySize: 1,
                                Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                                SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                                Usage: D3D11_USAGE_STAGING,
                                BindFlags: 0,
                                CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                                MiscFlags: 0,
                            };
                            let mut staging_tex = None;
                            self.device
                                .CreateTexture2D(&staging_desc, None, Some(&mut staging_tex))
                                .map_err(|e| {
                                    AppError::Io(std::io::Error::other(format!(
                                        "DXGI staging tex: {e}"
                                    )))
                                })?;
                            let staging_tex = staging_tex.ok_or_else(|| {
                                AppError::Io(std::io::Error::other("null staging tex"))
                            })?;
                            let staging_res: ID3D11Resource = staging_tex.cast().map_err(|e| {
                                AppError::Io(std::io::Error::other(format!(
                                    "staging res cast: {e}"
                                )))
                            })?;
                            return Ok(DxgiTargets {
                                src_width: src_w,
                                src_height: src_h,
                                target_mip,
                                dst_width: dst_w,
                                dst_height: dst_h,
                                mip_res: Some(mip_res),
                                mip_srv: Some(mip_srv),
                                staging_res,
                            });
                        }
                    }
                }

                // Fallback внутри DXGI без GenerateMips: полноразмерная staging texture + CPU stride.
                let staging_desc = D3D11_TEXTURE2D_DESC {
                    Width: src_w,
                    Height: src_h,
                    MipLevels: 1,
                    ArraySize: 1,
                    Format: DXGI_FORMAT_B8G8R8A8_UNORM,
                    SampleDesc: DXGI_SAMPLE_DESC { Count: 1, Quality: 0 },
                    Usage: D3D11_USAGE_STAGING,
                    BindFlags: 0,
                    CPUAccessFlags: D3D11_CPU_ACCESS_READ.0 as u32,
                    MiscFlags: 0,
                };
                let mut staging_tex = None;
                self.device
                    .CreateTexture2D(&staging_desc, None, Some(&mut staging_tex))
                    .map_err(|e| {
                        AppError::Io(std::io::Error::other(format!("DXGI full staging tex: {e}")))
                    })?;
                let staging_tex = staging_tex
                    .ok_or_else(|| AppError::Io(std::io::Error::other("null full staging tex")))?;
                let staging_res: ID3D11Resource = staging_tex
                    .cast()
                    .map_err(|e| AppError::Io(std::io::Error::other(format!("cast res: {e}"))))?;

                Ok(DxgiTargets {
                    src_width: src_w,
                    src_height: src_h,
                    target_mip: 0,
                    dst_width: src_w,
                    dst_height: src_h,
                    mip_res: None,
                    mip_srv: None,
                    staging_res,
                })
            }
        }

        fn capture(&mut self, timeout_ms: u32) -> AppResult<CaptureStep> {
            unsafe {
                let mut frame_info = DXGI_OUTDUPL_FRAME_INFO::default();
                let mut resource = None;
                match self
                    .duplication
                    .AcquireNextFrame(timeout_ms, &mut frame_info, &mut resource)
                {
                    Ok(()) => {}
                    Err(e) if e.code() == DXGI_ERROR_WAIT_TIMEOUT => {
                        return Ok(CaptureStep::Unchanged);
                    }
                    Err(e) if e.code() == DXGI_ERROR_ACCESS_LOST => {
                        return Err(AppError::Io(std::io::Error::other("DXGI_ERROR_ACCESS_LOST")));
                    }
                    Err(e) => {
                        return Err(AppError::Io(std::io::Error::other(format!(
                            "AcquireNextFrame: {e}"
                        ))));
                    }
                }

                // Всегда гарантированно освобождаем кадр DXGI даже при раннем выходе.
                let result = self.process_acquired_frame(&frame_info, resource);
                let _ = self.duplication.ReleaseFrame();
                result
            }
        }

        unsafe fn process_acquired_frame(
            &mut self,
            frame_info: &DXGI_OUTDUPL_FRAME_INFO,
            resource: Option<windows::Win32::Graphics::Dxgi::IDXGIResource>,
        ) -> AppResult<CaptureStep> {
            // Если изменился только курсор мыши, а сам рабочий стол не обновлялся — пропускаем.
            if self.has_presented_once && frame_info.LastPresentTime == 0 {
                return Ok(CaptureStep::Unchanged);
            }

            let Some(resource) = resource else {
                return Ok(CaptureStep::Unchanged);
            };
            let source_tex: ID3D11Texture2D = resource.cast().map_err(|e| {
                AppError::Io(std::io::Error::other(format!("DXGI texture cast: {e}")))
            })?;
            let source_res: ID3D11Resource = source_tex.cast().map_err(|e| {
                AppError::Io(std::io::Error::other(format!("DXGI resource cast: {e}")))
            })?;

            let mut desc = D3D11_TEXTURE2D_DESC::default();
            unsafe { source_tex.GetDesc(&mut desc) };
            if desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM
                && desc.Format != DXGI_FORMAT_B8G8R8A8_UNORM_SRGB
            {
                // HDR / 10-bit поверхность — отдаём GDI (DWM сам делает SDR tone-mapping).
                return Err(AppError::Io(std::io::Error::other(format!(
                    "unsupported DXGI surface format {:?}",
                    desc.Format
                ))));
            }

            self.ensure_targets(desc.Width, desc.Height)?;
            let targets = self.targets.as_ref().ok_or_else(|| {
                AppError::Io(std::io::Error::other("DXGI targets missing"))
            })?;

            if let (Some(mip_res), Some(mip_srv)) = (&targets.mip_res, &targets.mip_srv) {
                // 1) VRAM -> VRAM копия в mip 0
                unsafe {
                    self.context
                        .CopySubresourceRegion(mip_res, 0, 0, 0, 0, &source_res, 0, None);
                    // 2) Аппаратное построение mip-пирамиды на GPU (< 0.2 мс)
                    self.context.GenerateMips(mip_srv);
                    // 3) Копируем только уменьшенный mip-уровень (~300 КБ) в staging
                    self.context.CopySubresourceRegion(
                        &targets.staging_res,
                        0,
                        0,
                        0,
                        0,
                        mip_res,
                        targets.target_mip,
                        None,
                    );
                }
            } else {
                unsafe {
                    self.context.CopyResource(&targets.staging_res, &source_res);
                }
            }

            let mut mapped = D3D11_MAPPED_SUBRESOURCE::default();
            unsafe {
                self.context
                    .Map(&targets.staging_res, 0, D3D11_MAP_READ, 0, Some(&mut mapped))
                    .map_err(|e| {
                        AppError::Io(std::io::Error::other(format!("D3D11 Map staging: {e}")))
                    })?;
            }

            let pitch = mapped.RowPitch as usize;
            let height = targets.dst_height as usize;
            let bmp = if mapped.pData.is_null() {
                Err(AppError::Io(std::io::Error::other("mapped pData is null")))
            } else {
                let slice = unsafe {
                    std::slice::from_raw_parts(mapped.pData.cast::<u8>(), pitch * height)
                };
                if targets.mip_res.is_some() {
                    encode_bmp24_from_bgra_top_down(targets.dst_width, targets.dst_height, slice, pitch)
                } else {
                    encode_bmp24_from_bgra_downscaled(
                        targets.src_width,
                        targets.src_height,
                        slice,
                        pitch,
                    )
                }
            };

            unsafe { self.context.Unmap(&targets.staging_res, 0) };
            let bmp = bmp?;
            self.has_presented_once = true;
            Ok(CaptureStep::NewFrame(bmp))
        }
    }

    /// Быстрый персистентный GDI-захват: один `CreateDIBSection` и один `HDC` без пересоздания на кадр.
    struct FastGdiCapturer {
        memory_dc: HDC,
        bitmap: HBITMAP,
        prev_obj: HGDIOBJ,
        bits_ptr: *const u8,
        dst_w: u32,
        dst_h: u32,
        byte_len: usize,
    }

    impl FastGdiCapturer {
        fn new(width: u32, height: u32) -> AppResult<Self> {
            let (dst_w, dst_h) = downscaled_size(width, height);
            let dst_w_i = i32::try_from(dst_w)
                .map_err(|_| AppError::InvalidArgument("GDI width overflow".to_string()))?;
            let dst_h_i = i32::try_from(dst_h)
                .map_err(|_| AppError::InvalidArgument("GDI height overflow".to_string()))?;
            let byte_len = bmp_row_bytes(dst_w) * dst_h as usize;

            unsafe {
                let screen = GetDC(None);
                if screen.is_invalid() {
                    return Err(AppError::Io(std::io::Error::other("GDI GetDC failed")));
                }
                let memory_dc = CreateCompatibleDC(Some(screen));
                ReleaseDC(None, screen);
                if memory_dc.is_invalid() {
                    return Err(AppError::Io(std::io::Error::other(
                        "GDI CreateCompatibleDC failed",
                    )));
                }

                let bmi = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: u32::try_from(size_of::<BITMAPINFOHEADER>()).unwrap_or(40),
                        biWidth: dst_w_i,
                        biHeight: dst_h_i, // bottom-up 24-bit BGR
                        biPlanes: 1,
                        biBitCount: 24,
                        biCompression: BI_RGB.0,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let mut raw_bits: *mut c_void = std::ptr::null_mut();
                let bitmap =
                    match CreateDIBSection(Some(memory_dc), &bmi, DIB_RGB_COLORS, &mut raw_bits, None, 0)
                    {
                        Ok(bmp) if !bmp.is_invalid() && !raw_bits.is_null() => bmp,
                        _ => {
                            let _ = DeleteDC(memory_dc);
                            return Err(AppError::Io(std::io::Error::other(
                                "GDI CreateDIBSection failed",
                            )));
                        }
                    };
                let prev_obj = SelectObject(memory_dc, bitmap.into());
                SetStretchBltMode(memory_dc, COLORONCOLOR);

                Ok(Self {
                    memory_dc,
                    bitmap,
                    prev_obj,
                    bits_ptr: raw_bits.cast::<u8>(),
                    dst_w,
                    dst_h,
                    byte_len,
                })
            }
        }

        fn capture(&self, rect: CaptureRect) -> AppResult<Vec<u8>> {
            let src_w = i32::try_from(rect.width)
                .map_err(|_| AppError::InvalidArgument("GDI src width overflow".to_string()))?;
            let src_h = i32::try_from(rect.height)
                .map_err(|_| AppError::InvalidArgument("GDI src height overflow".to_string()))?;
            let dst_w_i = self.dst_w as i32;
            let dst_h_i = self.dst_h as i32;

            unsafe {
                let screen = GetDC(None);
                if screen.is_invalid() {
                    return Err(AppError::Io(std::io::Error::other("GDI GetDC failed")));
                }
                let ok = StretchBlt(
                    self.memory_dc,
                    0,
                    0,
                    dst_w_i,
                    dst_h_i,
                    Some(screen),
                    rect.x,
                    rect.y,
                    src_w,
                    src_h,
                    SRCCOPY,
                )
                .as_bool();
                ReleaseDC(None, screen);
                if !ok {
                    return Err(AppError::Io(std::io::Error::other("GDI StretchBlt failed")));
                }
                let pixels = std::slice::from_raw_parts(self.bits_ptr, self.byte_len);
                encode_bmp24(self.dst_w, self.dst_h, pixels)
            }
        }
    }

    impl Drop for FastGdiCapturer {
        fn drop(&mut self) {
            unsafe {
                if !self.memory_dc.is_invalid() {
                    let _ = SelectObject(self.memory_dc, self.prev_obj);
                }
                if !self.bitmap.is_invalid() {
                    let _ = DeleteObject(self.bitmap.into());
                }
                if !self.memory_dc.is_invalid() {
                    let _ = DeleteDC(self.memory_dc);
                }
            }
        }
    }

    /// Разовый снимок (используется в unit-тестах).
    #[cfg(test)]
    pub fn capture_region(x: i32, y: i32, width: u32, height: u32) -> AppResult<Vec<u8>> {
        let gdi = FastGdiCapturer::new(width, height)?;
        gdi.capture(CaptureRect {
            x,
            y,
            width,
            height,
        })
    }

    pub fn capture_worker_loop(inner: Arc<ServiceInner>) {
        let mut dxgi: Option<DxgiCapturer> = None;
        let mut gdi: Option<FastGdiCapturer> = None;
        let mut dxgi_retry_at: Option<Instant> = None;
        let mut idle_since: Option<Instant> = None;
        let mut seq: u64 = 0;

        loop {
            let rect = {
                let Ok(mut guard) = inner.control.lock() else {
                    return;
                };
                loop {
                    if guard.shutdown {
                        return;
                    }
                    if guard.active
                        && let Some(r) = guard.rect
                    {
                        idle_since = None;
                        break r;
                    }
                    // Спим с 0% CPU; через 2 с простоя освобождаем DXGI-дубликатор.
                    if dxgi.is_some() {
                        let start = *idle_since.get_or_insert_with(Instant::now);
                        if start.elapsed() >= IDLE_RELEASE_TIMEOUT {
                            dxgi = None;
                            idle_since = None;
                        } else {
                            let wait = IDLE_RELEASE_TIMEOUT.saturating_sub(start.elapsed());
                            let Ok((next, _)) = inner.control_cv.wait_timeout(guard, wait) else {
                                return;
                            };
                            guard = next;
                            continue;
                        }
                    }
                    let Ok(next) = inner.control_cv.wait(guard) else {
                        return;
                    };
                    guard = next;
                }
            };

            let tick_start = Instant::now();

            // Если геометрия оверлея изменилась — пересоздаём DXGI под новый монитор/размер.
            if dxgi.as_ref().is_some_and(|d| d.rect != rect) {
                dxgi = None;
            }

            let can_try_dxgi = dxgi_retry_at.is_none_or(|at| Instant::now() >= at);
            if dxgi.is_none() && can_try_dxgi {
                match DxgiCapturer::new(rect) {
                    Ok(cap) => {
                        dxgi = Some(cap);
                        dxgi_retry_at = None;
                    }
                    Err(err) => {
                        eprintln!("[FocusGlass] DXGI init failed, falling back to fast GDI: {err}");
                        dxgi_retry_at = Some(Instant::now() + DXGI_RETRY_COOLDOWN);
                    }
                }
            }

            let mut captured: Option<(&'static str, Vec<u8>)> = None;
            let mut need_gdi_fallback = dxgi.is_none();

            if let Some(cap) = dxgi.as_mut() {
                let wait_ms = if seq == 0 { 25 } else { 0 };
                match cap.capture(wait_ms) {
                    Ok(CaptureStep::NewFrame(bmp)) => {
                        captured = Some(("dxgi", bmp));
                    }
                    Ok(CaptureStep::Unchanged) => {
                        // Если ещё ни одного кадра не отдавали (статичный рабочий стол в момент старта),
                        // один раз подхватываем GDI, чтобы блюр появился мгновенно, без ожидания перерисовки DWM.
                        if inner.latest.read().ok().is_none_or(|g| g.is_none()) {
                            need_gdi_fallback = true;
                        }
                    }
                    Err(err) => {
                        eprintln!("[FocusGlass] DXGI capture reset ({err}), switching to fast GDI");
                        dxgi = None;
                        dxgi_retry_at = Some(Instant::now() + DXGI_RETRY_COOLDOWN);
                        need_gdi_fallback = true;
                    }
                }
            }

            if need_gdi_fallback && captured.is_none() {
                let (want_w, want_h) = downscaled_size(rect.width, rect.height);
                if gdi
                    .as_ref()
                    .is_none_or(|g| g.dst_w != want_w || g.dst_h != want_h)
                {
                    gdi = FastGdiCapturer::new(rect.width, rect.height).ok();
                }
                if let Some(g) = gdi.as_ref()
                    && let Ok(bmp) = g.capture(rect)
                {
                    captured = Some(("gdi", bmp));
                }
            }

            if let Some((backend, bmp)) = captured {
                seq = seq.wrapping_add(1).max(1);
                let frame = CachedFrame {
                    seq,
                    backend,
                    bmp: Arc::new(bmp),
                };
                if let Ok(mut guard) = inner.latest.write() {
                    *guard = Some(frame);
                }
                if let Ok(mut ready) = inner.frame_ready.lock() {
                    *ready = seq;
                    inner.frame_ready_cv.notify_all();
                }
            }

            let elapsed = tick_start.elapsed();
            if elapsed < TARGET_FRAME_INTERVAL {
                let sleep_for = TARGET_FRAME_INTERVAL - elapsed;
                if let Ok(guard) = inner.control.lock() {
                    if guard.active && !guard.shutdown {
                        let _ = inner.control_cv.wait_timeout(guard, sleep_for);
                    }
                } else {
                    thread::sleep(Duration::from_millis(16));
                }
            }
        }
    }

    pub fn set_capture_exclusion(window: &WebviewWindow, excluded: bool) -> AppResult<()> {
        let hwnd = window.hwnd()?;
        let affinity = if excluded {
            WDA_EXCLUDEFROMCAPTURE
        } else {
            WDA_NONE
        };
        // SAFETY: дескриптор принадлежит живому окну этого процесса.
        unsafe { SetWindowDisplayAffinity(hwnd, affinity) }
            .map_err(|e| AppError::Io(std::io::Error::other(e.to_string())))
    }
}

#[cfg(not(windows))]
mod platform {
    use tauri::WebviewWindow;

    use crate::error::{AppError, AppResult};

    pub fn set_capture_exclusion(_window: &WebviewWindow, excluded: bool) -> AppResult<()> {
        if excluded {
            return Err(AppError::InvalidArgument(
                "screen blur is only implemented for Windows".to_string(),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downscale_keeps_aspect_and_never_reaches_zero() {
        assert_eq!(downscaled_size(3440, 1440), (573, 240));
        assert_eq!(downscaled_size(1920, 1080), (320, 180));
        assert_eq!(downscaled_size(3, 2), (1, 1));
    }

    #[test]
    fn chooses_hardware_mip_level_by_resolution() {
        assert_eq!(choose_mip_level(3440, 1440), (3, 430, 180));
        assert_eq!(choose_mip_level(2560, 1440), (3, 320, 180));
        assert_eq!(choose_mip_level(1920, 1080), (2, 480, 270));
        assert_eq!(choose_mip_level(640, 480), (1, 320, 240));
    }

    #[test]
    fn parses_after_seq_query_parameter() {
        assert_eq!(parse_after_seq("http://fgcap.localhost/frame?after=42"), Some(42));
        assert_eq!(
            parse_after_seq("http://fgcap.localhost/frame?n=7&after=109&x=1"),
            Some(109)
        );
        assert_eq!(parse_after_seq("http://fgcap.localhost/frame?n=7"), None);
        assert_eq!(parse_after_seq("http://fgcap.localhost/frame?after=abc"), None);
    }

    #[test]
    fn bmp_rows_are_padded_to_four_bytes() {
        assert_eq!(bmp_row_bytes(1), 4);
        assert_eq!(bmp_row_bytes(4), 12);
        assert_eq!(bmp_row_bytes(5), 16);
        assert_eq!(bmp_row_bytes(573), 1720);
    }

    #[test]
    fn bmp_header_describes_the_image() {
        let (width, height) = (5u32, 3u32);
        let pixels = vec![0xABu8; bmp_row_bytes(width) * height as usize];
        let bmp = encode_bmp24(width, height, &pixels).expect("valid image");

        assert_eq!(&bmp[0..2], b"BM");
        let u32_at = |i: usize| u32::from_le_bytes([bmp[i], bmp[i + 1], bmp[i + 2], bmp[i + 3]]);
        assert_eq!(u32_at(2) as usize, bmp.len(), "file size field");
        assert_eq!(u32_at(10), 54, "pixel data offset");
        assert_eq!(u32_at(14), 40, "BITMAPINFOHEADER size");
        assert_eq!(u32_at(18), width);
        assert_eq!(u32_at(22), height);
        assert_eq!(u16::from_le_bytes([bmp[28], bmp[29]]), 24, "bits per pixel");
        assert_eq!(u32_at(30), 0, "BI_RGB");
        assert_eq!(&bmp[54..], &pixels[..]);
    }

    #[test]
    fn converts_top_down_bgra_with_row_pitch_padding_to_bottom_up_bmp24() {
        // 2x2 image with padded row_pitch = 12 (8 pixel bytes + 4 padding bytes per row)
        // Row 0 (top):    px(0,0)=(10,20,30,255), px(1,0)=(40,50,60,255)
        // Row 1 (bottom): px(0,1)=(70,80,90,255), px(1,1)=(100,110,120,255)
        let bgra: Vec<u8> = vec![
            10, 20, 30, 255, 40, 50, 60, 255, 0, 0, 0, 0,
            70, 80, 90, 255, 100, 110, 120, 255, 0, 0, 0, 0,
        ];
        let bmp = encode_bmp24_from_bgra_top_down(2, 2, &bgra, 12).expect("bgra->bmp");
        // bmp_row_bytes(2) = 8 (6 bytes BGR + 2 pad bytes)
        assert_eq!(bmp.len(), 54 + 16);
        // Bottom row comes first in BMP
        assert_eq!(&bmp[54..62], &[70, 80, 90, 100, 110, 120, 0, 0]);
        // Top row comes second in BMP
        assert_eq!(&bmp[62..70], &[10, 20, 30, 40, 50, 60, 0, 0]);
    }

    #[test]
    fn downscales_bgra_on_cpu_when_mip_autogen_unavailable() {
        let w = 12u32;
        let h = 12u32;
        let bgra = vec![0x33u8; (w * h * 4) as usize];
        let bmp = encode_bmp24_from_bgra_downscaled(w, h, &bgra, (w * 4) as usize).expect("downscale");
        let (dw, dh) = downscaled_size(w, h);
        assert_eq!((dw, dh), (2, 2));
        assert_eq!(bmp.len(), 54 + bmp_row_bytes(dw) * dh as usize);
    }

    #[test]
    fn bmp_rejects_wrong_buffer_size_and_empty_images() {
        assert_eq!(
            encode_bmp24(5, 3, &[0u8; 10]).expect_err("short buffer").kind(),
            "invalid_argument"
        );
        assert!(encode_bmp24(0, 3, &[]).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn captures_a_real_screen_region_as_valid_bmp() {
        // На CI или в изолированной сессии без рабочего стола GDI может отказать.
        let Ok(bmp) = platform::capture_region(0, 0, 600, 300) else {
            return;
        };
        let (w, h) = downscaled_size(600, 300);
        assert_eq!(&bmp[0..2], b"BM");
        assert_eq!(bmp.len(), 54 + bmp_row_bytes(w) * h as usize);
    }
}
