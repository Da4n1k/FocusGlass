//! Размытие окон других программ.
//!
//! CSS `backdrop-filter` в WebView размывает только саму веб-страницу, а эффекты
//! DWM для этой задачи непригодны (проверено на Windows 11: Acrylic превращает
//! экран в сплошную матовую «стену», BlurBehind — в чёрный прямоугольник).
//! Поэтому размытие делается честно: Rust снимает уменьшенную копию экрана под
//! оверлеем (GDI `StretchBlt`), а окно оверлея рисует её растянутой с CSS-фильтром
//! `blur()` нужного радиуса.
//!
//! Чтобы оверлей не попадал в собственный снимок, на время размытия ему ставится
//! `WDA_EXCLUDEFROMCAPTURE`. Побочный эффект: пока размытие активно, оверлей не
//! виден на скриншотах, записи экрана и в демонстрации экрана.

use std::borrow::Cow;

use tauri::http::{Response, StatusCode};
use tauri::{AppHandle, Manager, WebviewWindow};

use crate::error::{AppError, AppResult};
use crate::overlay::{OVERLAY_LABEL, OverlayController};

/// Схема URI, по которой окно оверлея забирает снимок: `http://fgcap.localhost/frame`.
pub const CAPTURE_SCHEME: &str = "fgcap";
/// Во сколько раз уменьшается снимок по каждой оси.
pub const DOWNSCALE: u32 = 6;

const BMP_HEADER_BYTES: usize = 54;

/// Размер уменьшенного снимка для области `width` x `height`.
pub fn downscaled_size(width: u32, height: u32) -> (u32, u32) {
    ((width / DOWNSCALE).max(1), (height / DOWNSCALE).max(1))
}

/// Длина строки 24-битного BMP с выравниванием на 4 байта.
pub fn bmp_row_bytes(width: u32) -> usize {
    (width as usize * 3).div_ceil(4) * 4
}

/// Собирает BMP-файл из 24-битных строк BGR, идущих снизу вверх (формат `GetDIBits`).
pub fn encode_bmp24(width: u32, height: u32, bottom_up_bgr: &[u8]) -> AppResult<Vec<u8>> {
    let pixel_bytes = bmp_row_bytes(width) * height as usize;
    if width == 0 || height == 0 || bottom_up_bgr.len() != pixel_bytes {
        return Err(AppError::InvalidArgument(format!(
            "BMP pixel buffer is {} bytes, expected {pixel_bytes} for {width}x{height}",
            bottom_up_bgr.len()
        )));
    }
    let too_large = || AppError::InvalidArgument("BMP image is too large".to_string());
    let file_bytes = u32::try_from(BMP_HEADER_BYTES + pixel_bytes).map_err(|_| too_large())?;
    let image_bytes = u32::try_from(pixel_bytes).map_err(|_| too_large())?;
    let width_i32 = i32::try_from(width).map_err(|_| too_large())?;
    let height_i32 = i32::try_from(height).map_err(|_| too_large())?;

    let mut bmp = Vec::with_capacity(BMP_HEADER_BYTES + pixel_bytes);
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
    bmp.extend_from_slice(bottom_up_bgr);
    Ok(bmp)
}

fn response(status: StatusCode, content_type: &str, body: Vec<u8>) -> Response<Cow<'static, [u8]>> {
    let mut response = Response::new(Cow::Owned(body));
    *response.status_mut() = status;
    let headers = response.headers_mut();
    if let Ok(value) = content_type.parse() {
        headers.insert("Content-Type", value);
    }
    if let Ok(value) = "no-store".parse() {
        headers.insert("Cache-Control", value);
    }
    response
}

/// Обработчик схемы `fgcap`: отдаёт снимок экрана только окну оверлея и только
/// пока размытие активно — иначе это был бы канал чтения экрана для любой страницы.
pub fn handle_capture_request(app: &AppHandle, webview_label: &str) -> Response<Cow<'static, [u8]>> {
    if webview_label != OVERLAY_LABEL {
        return response(StatusCode::FORBIDDEN, "text/plain", b"forbidden".to_vec());
    }
    let blur_active = app
        .try_state::<OverlayController>()
        .and_then(|controller| controller.with(|state| state.blur_active).ok())
        .unwrap_or(false);
    if !blur_active {
        return response(StatusCode::CONFLICT, "text/plain", b"blur is not active".to_vec());
    }

    match capture_under_overlay(app) {
        Ok(bmp) => response(StatusCode::OK, "image/bmp", bmp),
        Err(error) => response(
            StatusCode::INTERNAL_SERVER_ERROR,
            "text/plain",
            error.to_string().into_bytes(),
        ),
    }
}

fn capture_under_overlay(app: &AppHandle) -> AppResult<Vec<u8>> {
    let window = crate::overlay::overlay_window(app)?;
    let origin = window.outer_position()?;
    let size = window.outer_size()?;
    platform::capture_region(origin.x, origin.y, size.width, size.height)
}

/// Исключает окно из захвата экрана (или возвращает обратно).
pub fn set_capture_exclusion(window: &WebviewWindow, excluded: bool) -> AppResult<()> {
    platform::set_capture_exclusion(window, excluded)
}

#[cfg(windows)]
mod platform {
    use tauri::WebviewWindow;
    use windows::Win32::Graphics::Gdi::{
        BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CAPTUREBLT, CreateCompatibleBitmap,
        CreateCompatibleDC, DIB_RGB_COLORS, DeleteDC, DeleteObject, GetDC, GetDIBits, HALFTONE,
        ReleaseDC, SRCCOPY, SelectObject, SetStretchBltMode, StretchBlt,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE,
    };

    use super::{bmp_row_bytes, downscaled_size, encode_bmp24};
    use crate::error::{AppError, AppResult};

    fn gdi_error(what: &str) -> AppError {
        AppError::Io(std::io::Error::other(format!("screen capture: {what} failed")))
    }

    pub fn capture_region(x: i32, y: i32, width: u32, height: u32) -> AppResult<Vec<u8>> {
        let (dst_w, dst_h) = downscaled_size(width, height);
        let invalid = || AppError::InvalidArgument("capture region is too large".to_string());
        let (src_w, src_h) = (
            i32::try_from(width).map_err(|_| invalid())?,
            i32::try_from(height).map_err(|_| invalid())?,
        );
        let (dst_w_i, dst_h_i) = (
            i32::try_from(dst_w).map_err(|_| invalid())?,
            i32::try_from(dst_h).map_err(|_| invalid())?,
        );
        let mut pixels = vec![0u8; bmp_row_bytes(dst_w) * dst_h as usize];

        // SAFETY: все дескрипторы GDI создаются и освобождаются внутри блока; буфер
        // `pixels` имеет ровно тот размер, который GetDIBits запишет для 24 бит/пикс.
        let copied_lines = unsafe {
            let screen = GetDC(None);
            if screen.is_invalid() {
                return Err(gdi_error("GetDC"));
            }
            let memory = CreateCompatibleDC(Some(screen));
            let bitmap = CreateCompatibleBitmap(screen, dst_w_i, dst_h_i);
            let mut lines = 0;

            if !memory.is_invalid() && !bitmap.is_invalid() {
                let previous = SelectObject(memory, bitmap.into());
                SetStretchBltMode(memory, HALFTONE);
                let blitted = StretchBlt(
                    memory,
                    0,
                    0,
                    dst_w_i,
                    dst_h_i,
                    Some(screen),
                    x,
                    y,
                    src_w,
                    src_h,
                    SRCCOPY | CAPTUREBLT,
                )
                .as_bool();
                // GetDIBits требует, чтобы битмап не был выбран в контекст.
                SelectObject(memory, previous);

                if blitted {
                    let mut info = BITMAPINFO {
                        bmiHeader: BITMAPINFOHEADER {
                            biSize: u32::try_from(size_of::<BITMAPINFOHEADER>()).unwrap_or(40),
                            biWidth: dst_w_i,
                            biHeight: dst_h_i, // положительная высота = строки снизу вверх
                            biPlanes: 1,
                            biBitCount: 24,
                            biCompression: BI_RGB.0,
                            ..Default::default()
                        },
                        ..Default::default()
                    };
                    lines = GetDIBits(
                        memory,
                        bitmap,
                        0,
                        dst_h,
                        Some(pixels.as_mut_ptr().cast()),
                        &mut info,
                        DIB_RGB_COLORS,
                    );
                }
            }

            if !bitmap.is_invalid() {
                let _ = DeleteObject(bitmap.into());
            }
            if !memory.is_invalid() {
                let _ = DeleteDC(memory);
            }
            ReleaseDC(None, screen);
            lines
        };

        if copied_lines != dst_h_i {
            return Err(gdi_error("StretchBlt/GetDIBits"));
        }
        encode_bmp24(dst_w, dst_h, &pixels)
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

    pub fn capture_region(_x: i32, _y: i32, _width: u32, _height: u32) -> AppResult<Vec<u8>> {
        Err(AppError::InvalidArgument(
            "screen blur is only implemented for Windows".to_string(),
        ))
    }

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
        // На CI без рабочего стола GDI может отказать — тогда тест нечего проверять.
        let Ok(bmp) = platform::capture_region(0, 0, 600, 300) else {
            return;
        };
        let (w, h) = downscaled_size(600, 300);
        assert_eq!(&bmp[0..2], b"BM");
        assert_eq!(bmp.len(), 54 + bmp_row_bytes(w) * h as usize);
    }
}
