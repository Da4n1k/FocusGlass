// SPDX-License-Identifier: GPL-2.0-or-later
// Standalone X11 backend: keep the existing compositor (including Fly/compton).
// Read redirected window pixmaps, NEVER the final root-screen screenshot.
#include "effect_core.h"
#include <QGuiApplication>
#include <QImage>
#include <QOpenGLWindow>
#include <QScreen>
#include <QSurfaceFormat>
#include <QDebug>
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/Xutil.h>
#include <X11/extensions/Xcomposite.h>
#include <X11/extensions/Xfixes.h>
#include <X11/extensions/Xrender.h>
#include <X11/extensions/shape.h>
#include <algorithm>
#include <csignal>
#include <cstring>
#include <memory>
#include <set>
#include <unistd.h>
#include <sys/prctl.h>

namespace {
int lastXError = 0;
int handleXError(Display *, XErrorEvent *event) { lastXError = event->error_code; return 0; }

std::vector<unsigned long> property(Display *display, Window window, Atom name, Atom type)
{
    Atom actual = 0; int format = 0;
    unsigned long count = 0, remaining = 0;
    unsigned char *bytes = nullptr;
    const int result = XGetWindowProperty(display, window, name, 0, 4096, False, type,
        &actual, &format, &count, &remaining, &bytes);
    std::vector<unsigned long> values;
    if (result == Success && bytes && format == 32)
        values.assign(reinterpret_cast<unsigned long *>(bytes), reinterpret_cast<unsigned long *>(bytes) + count);
    if (bytes) XFree(bytes);
    return values;
}

class Capture {
public:
    explicit Capture(Display *connection) : display(connection), root(DefaultRootWindow(display))
    {
        pidAtom = XInternAtom(display, "_NET_WM_PID", False);
        typeAtom = XInternAtom(display, "_NET_WM_WINDOW_TYPE", False);
        dockAtom = XInternAtom(display, "_NET_WM_WINDOW_TYPE_DOCK", False);
        opaqueAtom = XInternAtom(display, "_NET_WM_OPAQUE_REGION", False);
    }
    ~Capture() { clear(); }
    QSize rootSize() const {
        XWindowAttributes attrs{};
        XGetWindowAttributes(display, root, &attrs);
        return {attrs.width, attrs.height};
    }
    bool initialize(QString &error) {
        int event = 0, code = 0;
        if (!XCompositeQueryExtension(display, &event, &code) || !XRenderQueryExtension(display, &event, &code)
            || !XFixesQueryExtension(display, &event, &code)) {
            error = "XComposite, XRender and XFixes are required"; return false;
        }
        const auto selection = XInternAtom(display, ("_NET_WM_CM_S" + QByteArray::number(DefaultScreen(display))).constData(), False);
        if (XGetSelectionOwner(display, selection) == None) {
            error = "No X11 compositing manager. Enable the existing Fly compositor; no replacement is installed.";
            return false;
        }
        return true;
    }
    void exclude(Window window) { own.insert(window); }
    std::vector<QRectF> protectedRects;
    int protectedWindows = 0;
    QImage frame(qint64 ownerPid, QString &error)
    {
        const auto rootDimensions = rootSize();
        // Downscale on the X server before readback: 16x less transfer at quarter size.
        const QSize wanted(std::max(1, rootDimensions.width()/4), std::max(1, rootDimensions.height()/4));
        if (size != wanted) {
            clear(); size = wanted;
            pixmap = XCreatePixmap(display, root, size.width(), size.height(), 24);
            auto *format = XRenderFindStandardFormat(display, PictStandardRGB24);
            destination = XRenderCreatePicture(display, pixmap, format, 0, nullptr);
        }
        XRenderColor black{0, 0, 0, 65535};
        XRenderFillRectangle(display, PictOpSrc, destination, &black, 0, 0, size.width(), size.height());
        Window returnedRoot = 0, parent = 0, *children = nullptr;
        unsigned count = 0;
        if (!XQueryTree(display, root, &returnedRoot, &parent, &children, &count)) {
            error = "Cannot enumerate X11 scene"; return {};
        }
        protectedRects.clear();
        std::vector<FocusGlass::SurfaceMask> surfaces;
        for (unsigned i = 0; i < count; ++i) {
            const Window window = children[i];
            if (own.contains(window)) continue;
            XWindowAttributes attrs{};
            if (!XGetWindowAttributes(display, window, &attrs) || attrs.map_state != IsViewable
                || attrs.c_class == InputOnly || attrs.width <= 0 || attrs.height <= 0) continue;
            const QRectF rectangle(attrs.x, attrs.y, attrs.width, attrs.height);

            lastXError = 0;
            const Pixmap named = XCompositeNameWindowPixmap(display, window);
            XSync(display, False);
            if (lastXError || named == None) continue; // Window may disappear between requests.
            auto *format = XRenderFindVisualFormat(display, attrs.visual);
            if (!format) { XFreePixmap(display, named); continue; }
            const Picture picture = XRenderCreatePicture(display, named, format, 0, nullptr);
            std::optional<QRegion> opaque;
            if (format->type == PictTypeDirect && format->direct.alphaMask) {
                // ARGB compositor/decoration surfaces can be fullscreen but
                // mostly transparent. Never let their bounds punch out all
                // protected regions underneath.
                opaque = QRegion();
                const auto values = property(display,window,opaqueAtom,XA_CARDINAL);
                for (size_t n=0; n+3<values.size(); n+=4) {
                    if (values[n+2]>unsigned(attrs.width) || values[n+3]>unsigned(attrs.height)) continue;
                    const int x = qint32(values[n]), y = qint32(values[n+1]);
                    if (x < -attrs.width || x > attrs.width || y < -attrs.height || y > attrs.height) continue;
                    const QRect local(x,y,int(values[n+2]),int(values[n+3]));
                    *opaque += local.intersected(QRect(0,0,attrs.width,attrs.height)).translated(attrs.x,attrs.y);
                }
            }
            surfaces.push_back({rectangle,isProtected(window, ownerPid, 0),opaque});
            XTransform transform{{{XDoubleToFixed(4), 0, 0}, {0, XDoubleToFixed(4), 0}, {0, 0, XDoubleToFixed(1)}}};
            XRenderSetPictureTransform(display, picture, &transform);
            XRenderSetPictureFilter(display, picture, FilterBilinear, nullptr, 0);
            XRenderComposite(display, PictOpOver, picture, None, destination, 0, 0, 0, 0,
                int(std::floor(attrs.x/4.0)), int(std::floor(attrs.y/4.0)),
                (attrs.width+3)/4, (attrs.height+3)/4);
            XRenderFreePicture(display, picture);
            XFreePixmap(display, named);
        }
        if (children) XFree(children);
        protectedRects = FocusGlass::visibleProtectedRects(surfaces);
        protectedWindows = int(std::count_if(surfaces.begin(),surfaces.end(),
            [](const auto &surface){return surface.protect;}));
        auto *image = XGetImage(display, pixmap, 0, 0, size.width(), size.height(), AllPlanes, ZPixmap);
        if (!image) { error = "X11 scene readback denied or unavailable"; return {}; }
        QImage result(size, QImage::Format_RGBA8888);
        // Xvfb/Fly's usual 32-bit little-endian path; handle other visuals without assumptions.
        if (image->bits_per_pixel == 32 && image->byte_order == LSBFirst
            // XGetImage of a pixmap can report zero masks; its format is explicitly
            // PictStandardRGB24 above, so the channel order is still known.
            && (image->red_mask == 0 || (image->red_mask == 0xff0000
                && image->green_mask == 0xff00 && image->blue_mask == 0xff))) {
            for (int y = 0; y < size.height(); ++y) {
                auto *out = result.scanLine(size.height()-1-y);
                const auto *in = reinterpret_cast<const unsigned char *>(image->data + y*image->bytes_per_line);
                for (int x = 0; x < size.width(); ++x) {
                    out[4*x] = in[4*x+2]; out[4*x+1] = in[4*x+1]; out[4*x+2] = in[4*x]; out[4*x+3] = 255;
                }
            }
        } else {
            XDestroyImage(image);
            error = "Unsupported X11 visual; refusing incorrect color capture";
            return {};
        }
        XDestroyImage(image);
        return result;
    }
    QPointF cursor() const {
        Window r = 0, child = 0; int rx = 0, ry = 0, wx = 0, wy = 0; unsigned mask = 0;
        if (!XQueryPointer(display, root, &r, &child, &rx, &ry, &wx, &wy, &mask)) return {-9999, -9999};
        return {double(rx), double(ry)};
    }
private:
    bool isProtected(Window window, qint64 ownerPid, int depth) {
        const auto pid = property(display, window, pidAtom, XA_CARDINAL);
        if (!pid.empty() && qint64(pid[0]) == ownerPid && ownerPid > 0) return true;
        const auto types = property(display, window, typeAtom, XA_ATOM);
        if (std::find(types.begin(), types.end(), dockAtom) != types.end()) return true;
        if (depth >= 3) return false;
        Window r = 0, p = 0, *children = nullptr; unsigned count = 0;
        bool protectedWindow = false;
        if (XQueryTree(display, window, &r, &p, &children, &count)) {
            for (unsigned i = 0; i < count && !protectedWindow; ++i)
                protectedWindow = isProtected(children[i], ownerPid, depth+1);
        }
        if (children) XFree(children);
        return protectedWindow;
    }
    void clear() {
        if (destination) XRenderFreePicture(display, destination);
        if (pixmap) XFreePixmap(display, pixmap);
        destination = 0; pixmap = 0;
    }
    Display *display;
    Window root;
    Atom pidAtom, typeAtom, dockAtom, opaqueAtom;
    std::set<Window> own;
    QSize size;
    Pixmap pixmap = 0;
    Picture destination = 0;
};

class Overlay final : public QOpenGLWindow {
public:
    Overlay(Display *display, Capture &capture, FocusGlass::ControlServer &control)
        : display(display), capture(capture), control(control)
    {
        setTitle("FocusGlass native effects");
        setFlags(Qt::Tool | Qt::FramelessWindowHint | Qt::WindowStaysOnTopHint
            | Qt::WindowDoesNotAcceptFocus | Qt::WindowTransparentForInput | Qt::BypassWindowManagerHint);
        setGeometry(QRect(QPoint(), capture.rootSize()));
        create();
        const auto id = ::Window(winId());
        capture.exclude(id);
        const auto region = XFixesCreateRegion(display, nullptr, 0);
        XFixesSetWindowShapeRegion(display, id, ShapeInput, 0, 0, region);
        XFixesDestroyRegion(display, region);
        const unsigned long pid = getpid();
        XChangeProperty(display, id, XInternAtom(display, "_NET_WM_PID", False),
            XA_CARDINAL, 32, PropModeReplace, reinterpret_cast<const unsigned char *>(&pid), 1);
        XFlush(display);
    }
    ~Overlay() override { makeCurrent(); renderer.reset(); if (source) glDeleteTextures(1, &source); doneCurrent(); }
    void advance() {
        if (control.running()) {
            const QRect wanted(QPoint(), capture.rootSize());
            if (geometry() != wanted) setGeometry(wanted);
            if (!isVisible()) show();
            update();
        } else if (isVisible()) hide();
    }
protected:
    void initializeGL() override {
        renderer = std::make_unique<FocusGlass::Renderer>();
        if (!renderer->initialize(control.error)) { hide(); return; }
        glGenTextures(1, &source);
        glBindTexture(GL_TEXTURE_2D, source);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        clock.start();
    }
    void paintGL() override {
        glClearColor(0, 0, 0, 0); glClear(GL_COLOR_BUFFER_BIT);
        if (!control.running() || !control.error.isEmpty() || !renderer) return;
        const QImage image = capture.frame(control.ownerPid, control.error);
        if (image.isNull()) { hide(); return; }
        if (capture.protectedRects.size() > 64) {
            control.error = "Too many protected windows; effect disabled for safety";
            hide(); return;
        }
        glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, source);
        if (sourceSize != image.size()) {
            sourceSize = image.size();
            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, image.width(), image.height(), 0, GL_RGBA, GL_UNSIGNED_BYTE, image.constBits());
        } else {
            glTexSubImage2D(GL_TEXTURE_2D, 0, 0, 0, image.width(), image.height(), GL_RGBA, GL_UNSIGNED_BYTE, image.constBits());
        }
        control.protectedWindows = capture.protectedWindows;
        renderer->render(source, sourceSize, QRectF(geometry()), size()*devicePixelRatio(),
            capture.protectedRects, control.amount, control.radius, control.elapsed,
            capture.cursor(), clock.restart()/1000.0, control.frozen, true);
        ++control.frames;
    }
private:
    Display *display;
    Capture &capture;
    FocusGlass::ControlServer &control;
    std::unique_ptr<FocusGlass::Renderer> renderer;
    QElapsedTimer clock;
    GLuint source = 0;
    QSize sourceSize;
};
}

int main(int argc, char **argv)
{
    // A process exit does not run Rust worker-thread destructors. Automatically
    // launched helpers must not survive their controlling application.
    bool hasParent = false;
    const int expectedParent = qEnvironmentVariableIntValue("FOCUSGLASS_PARENT_PID", &hasParent);
    if (hasParent && expectedParent > 0) {
        if (prctl(PR_SET_PDEATHSIG, SIGTERM) != 0) return 1;
        if (getppid() != expectedParent) return 0; // Parent died before prctl.
    }
    QSurfaceFormat format;
    format.setVersion(3, 3); format.setProfile(QSurfaceFormat::CoreProfile);
    format.setAlphaBufferSize(8); format.setSwapInterval(1);
    QSurfaceFormat::setDefaultFormat(format);
    QGuiApplication app(argc, argv);
    Display *display = XOpenDisplay(nullptr);
    if (!display) { qCritical() << "Cannot connect to X11"; return 1; }
    XSetErrorHandler(handleXError);
    Capture capture(display);
    FocusGlass::ControlServer control("x11-xcomposite-gpu");
    if (!capture.initialize(control.error) || !control.listen(FocusGlass::socketPath())) {
        qCritical() << control.error; return 1;
    }
    Overlay overlay(display, capture, control);
    QTimer cadence;
    cadence.setInterval(33); // 30 FPS; idle performs no capture/render/readback.
    QObject::connect(&cadence, &QTimer::timeout, &app, [&] { overlay.advance(); });
    cadence.start();
    qInfo() << "FocusGlass X11 native backend ready:" << FocusGlass::socketPath();
    return app.exec();
}
