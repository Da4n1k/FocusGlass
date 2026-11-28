#pragma once

#include <epoxy/gl.h>
#include <QElapsedTimer>
#include <QJsonObject>
#include <QLocalServer>
#include <QPointF>
#include <QRectF>
#include <QSize>
#include <QTimer>
#include <QMatrix4x4>
#include <QRegion>
#include <optional>
#include <functional>
#include <vector>

namespace FocusGlass {

struct SurfaceMask {
    QRectF rect;
    bool protect = false;
    // If known, use the compositor's genuinely opaque region, not the bounding
    // rectangle of a transparent fullscreen surface. nullopt is the X11 fallback.
    std::optional<QRegion> opaque = std::nullopt;
    // Docks often have large transparent margins for shadows/autohide. Protect
    // their actual input region, not the buffer bounds or reserved work area.
    std::optional<QRegion> protection = std::nullopt;
};
// Bottom-to-top stacking order, containing only currently visible surfaces.
// A foreground foreign window must not inherit the sharp rectangle of controls
// below it. Recomputed each frame, never cached across hide/move/minimize.
std::vector<QRectF> visibleProtectedRects(const std::vector<SurfaceMask> &surfaces);

// Local, same-user, bounded JSON protocol. No privileged service or screen-capture portal.
class ControlServer {
public:
    explicit ControlServer(QString backend);
    bool listen(const QString &path);
    bool running() const;
    void tick();
    double amount = 0;
    double radius = 4;
    double elapsed = 0;
    bool frozen = false;
    qint64 ownerPid = 0;
    quint64 frames = 0;
    int protectedWindows = 0;
    int protectedControls = 0;
    QString error;
    QJsonObject diagnostics;
    quint64 diagnosticSerial = 0; // Explicit opt-in; one scalar-only GPU probe per output.
    std::function<void()> repaint;
    QJsonObject status() const;
private:
    QJsonObject handle(const QJsonObject &request, qint64 peerPid);
    QLocalServer server;
    QTimer timer;
    QElapsedTimer clock;
    QString backend;
    qint64 heartbeat = -10000;
    qint64 previewUntil = 0;
    qint64 previous = 0;
    double target = 0;
    double requestedRadius = 4;
    double previewRadius = 8;
    bool wasRunning = false;
    bool diagnosticPreview = false;
};

struct Particle {
    QPointF home, position, velocity;
    float seed, alpha;
};

// Shared frame-rate-independent physics, seeded deterministically per output.
class ParticleField {
public:
    void resize(const QSize &logicalSize);
    void update(double dt, double elapsed, QPointF cursor, bool frozen);
    void reset();
    const std::vector<Particle> &points() const { return particles; }
private:
    QSize size;
    std::vector<Particle> particles;
};

// Both backends use the exact same real separable GPU blur and particle renderer.
// All GL objects are created lazily with a current context; never touched on the EEG thread.
class Renderer {
public:
    ~Renderer();
    bool initialize(QString &error);
    void render(GLuint source, const QSize &sourceSize, const QRectF &logicalRect,
                const QSize &targetSize, const std::vector<QRectF> &protectedRects,
                double amount, double radius, double elapsed, QPointF cursor,
                double dt, bool frozen, bool transparent,
                const QMatrix4x4 &outputTransform = QMatrix4x4());
private:
    GLuint blurProgram = 0, mixProgram = 0, pointProgram = 0;
    GLuint vao = 0, pointBuffer = 0;
    GLuint textures[2] = {}, fbos[2] = {};
    QSize bufferSize;
    struct DownsampleLevel {
        GLuint texture = 0, fbo = 0;
        QSize size;
    };
    std::vector<DownsampleLevel> downsampleLevels;
    ParticleField field;
    double previousElapsed = -1;
    void allocate(const QSize &size);
};

QString socketPath();
bool finiteNumber(const QJsonObject &object, const char *key, double &value);
double revealOpacity(QPointF normalizedPosition, double elapsed, bool blur);
// Normalized symmetric Gaussian, center followed by positive offsets.
std::vector<float> gaussianKernel(double sigma);
}
