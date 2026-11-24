#include "effect_core.h"

#include <QDir>
#include <QJsonDocument>
#include <QLocalSocket>
#include <QStandardPaths>
#include <algorithm>
#include <cmath>
#include <sys/socket.h>
#include <unistd.h>

namespace FocusGlass {
QString socketPath()
{
    const auto explicitPath = qEnvironmentVariable("FOCUSGLASS_EFFECT_SOCKET");
    if (!explicitPath.isEmpty()) return explicitPath;
    auto display = qEnvironmentVariable("WAYLAND_DISPLAY");
    if (display.isEmpty()) display = qEnvironmentVariable("DISPLAY");
    display.replace('/', '_');
    return QStandardPaths::writableLocation(QStandardPaths::RuntimeLocation)
        + "/focusglass-effects-" + display + ".sock";
}

bool finiteNumber(const QJsonObject &object, const char *key, double &value)
{
    if (!object.value(key).isDouble()) return false;
    value = object.value(key).toDouble();
    return std::isfinite(value);
}

ControlServer::ControlServer(QString name) : backend(std::move(name))
{
    clock.start();
    timer.setInterval(16);
    QObject::connect(&timer, &QTimer::timeout, &server, [this] { tick(); });
    QObject::connect(&server, &QLocalServer::newConnection, &server, [this] {
        while (auto *client = server.nextPendingConnection()) {
            ucred peer{};
            socklen_t size = sizeof(peer);
            if (getsockopt(client->socketDescriptor(), SOL_SOCKET, SO_PEERCRED, &peer, &size) != 0
                || peer.uid != getuid()) { client->deleteLater(); continue; }
            client->setReadBufferSize(8192);
            QObject::connect(client, &QLocalSocket::readyRead, client, [this, client, peer] {
                if (client->bytesAvailable() >= 8192 && !client->canReadLine()) {
                    client->abort(); return;
                }
                while (client->canReadLine()) {
                    if (client->bytesToWrite() > 65536) { client->abort(); return; }
                    const auto bytes = client->readLine(8192);
                    QJsonParseError parseError{};
                    const auto document = QJsonDocument::fromJson(bytes, &parseError);
                    auto reply = (parseError.error == QJsonParseError::NoError && document.isObject())
                        ? handle(document.object(), peer.pid)
                        : QJsonObject{{"ok", false}, {"error", "Invalid JSON"}};
                    client->write(QJsonDocument(reply).toJson(QJsonDocument::Compact) + '\n');
                }
            });
            QObject::connect(client, &QLocalSocket::disconnected, client, &QObject::deleteLater);
        }
    });
}

bool ControlServer::listen(const QString &path)
{
    server.setSocketOptions(QLocalServer::UserAccessOption);
    // Never remove another live instance's socket or replace the user's compositor.
    if (!server.listen(path)) { error = server.errorString(); return false; }
    timer.start();
    return true;
}

bool ControlServer::running() const { return amount > 0.001; }

QJsonObject ControlServer::status() const
{
    return {{"ok", error.isEmpty()}, {"error", error}, {"backend", backend},
        {"active", running()}, {"frames", double(frames)}, {"protectedWindows", protectedWindows},
        {"radius", radius}, {"amount", amount}, {"elapsed", elapsed}, {"particles", true}, {"cursorInteraction", true},
        {"diagnostics", diagnostics}};
}

QJsonObject ControlServer::handle(const QJsonObject &request, qint64 peerPid)
{
    const auto operation = request.value("op").toString();
    if (operation == "update") {
        double requestedAmount = 0, requestedRadius = 0;
        if (!finiteNumber(request, "amount", requestedAmount)
            || !finiteNumber(request, "radius", requestedRadius)
            || requestedAmount < 0 || requestedAmount > 1 || requestedRadius < 0 || requestedRadius > 16) {
            return {{"ok", false}, {"error", "Invalid effect target"}};
        }
        target = requestedAmount;
        this->requestedRadius = requestedRadius;
        ownerPid = peerPid; // OS-verified peer, not an arbitrary PID from JSON.
        frozen = request.value("frozen").toBool(false);
        heartbeat = clock.elapsed();
    } else if (operation == "preview" || operation == "diagnose") {
        double previewRadius = 8;
        if (request.contains("radius") && (!finiteNumber(request,"radius",previewRadius)
            || previewRadius <= 0 || previewRadius > 16)) {
            return {{"ok",false},{"error","Invalid preview radius"}};
        }
        this->previewRadius = previewRadius;
        if (operation == "diagnose") ++diagnosticSerial;
        previewUntil = clock.elapsed() + 3000;
        ownerPid = peerPid;
        radius = previewRadius;
        // Preview is a 3-second renderer check, not a replay of the 4.16-second intro.
        elapsed = std::max(elapsed, 3.2);
    } else if (operation == "stop") {
        target = 0;
        previewUntil = 0;
        heartbeat = -10000;
        frozen = false;
    } else if (operation != "status") {
        return {{"ok", false}, {"error", "Unknown operation"}};
    }
    tick();
    return status();
}

void ControlServer::tick()
{
    const auto now = clock.elapsed();
    const double dt = std::clamp((now - previous) / 1000.0, 0.0, 0.05);
    previous = now;
    radius = now < previewUntil ? previewRadius : requestedRadius;
    const double wanted = now < previewUntil ? 1.0
        : now - heartbeat < 1500 && requestedRadius > 0 ? target : 0;
    if (wanted > 0 && !wasRunning) elapsed = now < previewUntil ? 3.2 : 0;
    wasRunning = wanted > 0 || running();
    if (!frozen || wanted == 0) {
        if (wanted > 0) elapsed += dt;
        amount += (wanted - amount) * (1 - std::exp(-dt / 0.18));
    }
    if (wanted == 0 && amount < 0.002) amount = 0;
    if (repaint && (running() || wasRunning)) repaint();
    wasRunning = wanted > 0 || running();
}

static float hash(int x, int y)
{
    quint32 v = quint32(x) * 374761393u + quint32(y) * 668265263u + 0x9e3779b9u;
    v = (v ^ (v >> 13)) * 1274126177u;
    return float(v ^ (v >> 16)) / float(UINT32_MAX);
}

void ParticleField::resize(const QSize &logicalSize)
{
    if (size == logicalSize) return;
    size = logicalSize;
    particles.clear();
    for (int y = 26; y < size.height(); y += 52) {
        for (int x = 26; x < size.width(); x += 52) {
            const QPointF home(x + (hash(x, y) - 0.5) * 30, y + (hash(y, x) - 0.5) * 30);
            particles.push_back({home, home, {}, hash(x + 1, y) * 30, 0.25f + hash(x, y + 1) * 0.55f});
        }
    }
}

void ParticleField::update(double dt, double elapsed, QPointF cursor, bool frozen)
{
    if (frozen) return;
    dt = std::clamp(dt, 0.0, 0.033);
    for (auto &p : particles) {
        const QPointF home = p.home + QPointF(std::sin(elapsed * 0.4 + p.seed) * 12,
                                               std::cos(elapsed * 0.5 + p.seed) * 12);
        QPointF acceleration = (home - p.position) * 28;
        const QPointF delta = p.position - cursor;
        const double distance = std::hypot(delta.x(), delta.y());
        if (distance < 115 && distance > 0.5) {
            const double falloff = 1 - distance / 115;
            acceleration += delta / distance * (55 * 28 * falloff * falloff);
        }
        p.velocity = (p.velocity + acceleration * dt) * std::exp(-8 * dt);
        p.position += p.velocity * dt;
    }
}

void ParticleField::reset()
{
    for (auto &p : particles) { p.position = p.home; p.velocity = {}; }
}

static constexpr auto vertexSource = R"(
#version 150
out vec2 uv;
uniform mat4 transform;
void main() {
    uv = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
    gl_Position = transform * vec4(uv * 2.0 - 1.0, 0.0, 1.0);
})";
static constexpr auto blurSource = R"(
#version 150
uniform sampler2D source;
uniform vec2 direction;
in vec2 uv;
out vec4 color;
void main() {
    vec3 sum = texture(source, uv).rgb * 0.227027;
    sum += texture(source, uv + direction * 1.384615).rgb * 0.316216;
    sum += texture(source, uv - direction * 1.384615).rgb * 0.316216;
    sum += texture(source, uv + direction * 3.230769).rgb * 0.070270;
    sum += texture(source, uv - direction * 3.230769).rgb * 0.070270;
    color = vec4(sum, 1.0);
})";
static constexpr auto mixSource = R"(
#version 150
uniform sampler2D source, blurred;
uniform vec4 outputRect;
uniform vec4 protectedRects[64];
uniform int protectedCount, transparent;
uniform float amount, elapsed;
in vec2 uv;
out vec4 color;
void main() {
    vec2 local = vec2(uv.x, 1.0 - uv.y) * outputRect.zw;
    vec2 position = local + outputRect.xy;
    for (int i = 0; i < protectedCount; ++i) {
        vec4 r = protectedRects[i];
        if (position.x >= r.x && position.y >= r.y && position.x < r.x+r.z && position.y < r.y+r.w)
            discard;
    }
    // Feedback must start on threshold crossing, not after the optional particle
    // introduction. Mix with the sharp scene only while fading, never at rest.
    float alpha = clamp(amount, 0.0, 1.0);
    vec3 soft = texture(blurred, uv).rgb;
    // A gentle neutral glass veil, not an opaque grey wall.
    soft = mix(soft, vec3(0.88,0.93,1.0), 0.015);
    color = transparent != 0 ? vec4(soft * alpha, alpha)
        : vec4(mix(texture(source, uv).rgb, soft, alpha), 1.0);
})";
static constexpr auto pointVertex = R"(
#version 150
in vec3 particle;
uniform vec2 extent;
uniform float scale;
uniform mat4 transform;
out float alpha;
void main() {
    gl_Position = transform * vec4(particle.x / extent.x * 2.0 - 1.0, 1.0 - particle.y / extent.y * 2.0, 0, 1);
    gl_PointSize = 3.0 * scale;
    alpha = particle.z;
})";
static constexpr auto pointFragment = R"(
#version 150
in float alpha;
out vec4 color;
void main() {
    float edge = 1.0 - smoothstep(0.3, 0.5, length(gl_PointCoord - vec2(0.5)));
    color = vec4(vec3(alpha * edge), alpha * edge);
})";

static GLuint program(const char *vertex, const char *fragment, QString &error)
{
    GLuint shaders[2] = {glCreateShader(GL_VERTEX_SHADER), glCreateShader(GL_FRAGMENT_SHADER)};
    const char *sources[2] = {vertex, fragment};
    QByteArray converted[2];
    if (!epoxy_is_desktop_gl()) {
        for (int i = 0; i < 2; ++i) {
            converted[i] = QByteArray(sources[i]).replace("#version 150",
                "#version 300 es\nprecision highp float;\nprecision highp int;");
            sources[i] = converted[i].constData();
        }
    }
    for (int i = 0; i < 2; ++i) {
        glShaderSource(shaders[i], 1, &sources[i], nullptr);
        glCompileShader(shaders[i]);
        GLint compiled = 0;
        glGetShaderiv(shaders[i], GL_COMPILE_STATUS, &compiled);
        if (!compiled) {
            char log[4096]{};
            glGetShaderInfoLog(shaders[i], sizeof(log), nullptr, log);
            error = QString::fromUtf8(log);
            for (const auto shader : shaders) glDeleteShader(shader);
            return 0;
        }
    }
    const GLuint result = glCreateProgram();
    for (const auto shader : shaders) glAttachShader(result, shader);
    glBindAttribLocation(result, 0, "particle");
    glLinkProgram(result);
    for (const auto shader : shaders) glDeleteShader(shader);
    GLint linked = 0;
    glGetProgramiv(result, GL_LINK_STATUS, &linked);
    if (!linked) {
        char log[4096]{};
        glGetProgramInfoLog(result, sizeof(log), nullptr, log);
        error = QString::fromUtf8(log);
        glDeleteProgram(result);
        return 0;
    }
    return result;
}

bool Renderer::initialize(QString &error)
{
    if (blurProgram && mixProgram && pointProgram) return true;
    blurProgram = program(vertexSource, blurSource, error);
    mixProgram = program(vertexSource, mixSource, error);
    pointProgram = program(pointVertex, pointFragment, error);
    if (!blurProgram || !mixProgram || !pointProgram) return false;
    glGenVertexArrays(1, &vao);
    glGenBuffers(1, &pointBuffer);
    glGenTextures(2, textures);
    glGenFramebuffers(2, fbos);
    return true;
}

Renderer::~Renderer()
{
    if (!blurProgram) return;
    glDeleteProgram(blurProgram); glDeleteProgram(mixProgram); glDeleteProgram(pointProgram);
    glDeleteVertexArrays(1, &vao); glDeleteBuffers(1, &pointBuffer);
    glDeleteTextures(2, textures); glDeleteFramebuffers(2, fbos);
    for (const auto &level : downsampleLevels) {
        glDeleteTextures(1,&level.texture);
        glDeleteFramebuffers(1,&level.fbo);
    }
}

void Renderer::allocate(const QSize &size)
{
    if (size == bufferSize) return;
    bufferSize = size;
    for (int i = 0; i < 2; ++i) {
        glBindTexture(GL_TEXTURE_2D, textures[i]);
        glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, size.width(), size.height(), 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
        glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
        glBindFramebuffer(GL_FRAMEBUFFER, fbos[i]);
        glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, textures[i], 0);
    }
}

void Renderer::render(GLuint source, const QSize &sourceSize, const QRectF &rect,
                      const QSize &targetSize, const std::vector<QRectF> &protectedRects,
                      double amount, double radius, double elapsed, QPointF cursor,
                      double dt, bool frozen, bool transparent, const QMatrix4x4 &outputTransform)
{
    // Restore the compositor's state. In particular, never leak an FBO, viewport, VAO or shader.
    GLint target = 0, oldRead = 0, viewport[4]{}, oldProgram = 0, oldVao = 0, oldActive = 0, oldBuffer = 0;
    GLint blendSrc = 0, blendDst = 0, blendSrcAlpha = 0, blendDstAlpha = 0, oldTexture[2]{}, oldSampler[2]{};
    glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &target); glGetIntegerv(GL_VIEWPORT, viewport);
    glGetIntegerv(GL_READ_FRAMEBUFFER_BINDING, &oldRead);
    glGetIntegerv(GL_CURRENT_PROGRAM, &oldProgram); glGetIntegerv(GL_VERTEX_ARRAY_BINDING, &oldVao);
    glGetIntegerv(GL_ARRAY_BUFFER_BINDING, &oldBuffer); glGetIntegerv(GL_ACTIVE_TEXTURE, &oldActive);
    glGetIntegerv(GL_BLEND_SRC_RGB, &blendSrc); glGetIntegerv(GL_BLEND_DST_RGB, &blendDst);
    glGetIntegerv(GL_BLEND_SRC_ALPHA, &blendSrcAlpha); glGetIntegerv(GL_BLEND_DST_ALPHA, &blendDstAlpha);
    const bool blend = glIsEnabled(GL_BLEND), scissor = glIsEnabled(GL_SCISSOR_TEST);
    const bool depth = glIsEnabled(GL_DEPTH_TEST), stencil = glIsEnabled(GL_STENCIL_TEST);
    const bool desktop = epoxy_is_desktop_gl();
    const bool points = desktop && glIsEnabled(GL_PROGRAM_POINT_SIZE);
    for (int i = 0; i < 2; ++i) {
        glActiveTexture(GL_TEXTURE0+i);
        glGetIntegerv(GL_TEXTURE_BINDING_2D, &oldTexture[i]);
        glGetIntegerv(GL_SAMPLER_BINDING, &oldSampler[i]);
        // KWin's sampler objects can require mipmaps. Our single-level render
        // textures must use their own linear/clamp parameters instead.
        glBindSampler(i, 0);
    }
    glDisable(GL_BLEND); glDisable(GL_SCISSOR_TEST); glDisable(GL_DEPTH_TEST); glDisable(GL_STENCIL_TEST);
    glActiveTexture(GL_TEXTURE0);
    glBindVertexArray(vao);
    glUseProgram(blurProgram);
    const QMatrix4x4 identity;
    glUniformMatrix4fv(glGetUniformLocation(blurProgram, "transform"), 1, GL_FALSE, identity.constData());
    glUniform1i(glGetUniformLocation(blurProgram, "source"), 0);
    // Prefilter large radii with successive exact 2x reductions. Jumping to a
    // small texture in one bilinear sample aliases text; widely spaced Gaussian
    // taps alone produce multiple sharp ghosts rather than a strong blur.
    GLuint filteredSource = source;
    QSize filteredSize = sourceSize;
    const double desiredPixelSize = std::max(rect.width()/sourceSize.width(), radius/2);
    size_t levelIndex = 0;
    while (filteredSize.width()>1 && filteredSize.height()>1
        && rect.width()/filteredSize.width()*2 <= desiredPixelSize) {
        const QSize nextSize(std::max(1,(filteredSize.width()+1)/2),
                             std::max(1,(filteredSize.height()+1)/2));
        if (downsampleLevels.size()<=levelIndex) {
            DownsampleLevel level;
            glGenTextures(1,&level.texture);
            glGenFramebuffers(1,&level.fbo);
            downsampleLevels.push_back(level);
        }
        auto &level = downsampleLevels[levelIndex++];
        if (level.size!=nextSize) {
            level.size=nextSize;
            glBindTexture(GL_TEXTURE_2D,level.texture);
            glTexImage2D(GL_TEXTURE_2D,0,GL_RGBA8,nextSize.width(),nextSize.height(),0,GL_RGBA,GL_UNSIGNED_BYTE,nullptr);
            glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MIN_FILTER,GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_MAG_FILTER,GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_S,GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D,GL_TEXTURE_WRAP_T,GL_CLAMP_TO_EDGE);
            glBindFramebuffer(GL_FRAMEBUFFER,level.fbo);
            glFramebufferTexture2D(GL_FRAMEBUFFER,GL_COLOR_ATTACHMENT0,GL_TEXTURE_2D,level.texture,0);
        }
        glBindFramebuffer(GL_FRAMEBUFFER,level.fbo);
        glViewport(0,0,nextSize.width(),nextSize.height());
        glBindTexture(GL_TEXTURE_2D,filteredSource);
        glUniform2f(glGetUniformLocation(blurProgram,"direction"),0,0);
        glDrawArrays(GL_TRIANGLES,0,3);
        filteredSource=level.texture;
        filteredSize=nextSize;
    }
    allocate(filteredSize);
    for (int pass = 0; pass < 2; ++pass) {
        glBindFramebuffer(GL_FRAMEBUFFER, fbos[pass]);
        glViewport(0, 0, bufferSize.width(), bufferSize.height());
        glBindTexture(GL_TEXTURE_2D, pass == 0 ? filteredSource : textures[0]);
        glUniform2f(glGetUniformLocation(blurProgram, "direction"),
            pass == 0 ? radius / rect.width() : 0,
            pass == 1 ? radius / rect.height() : 0);
        glDrawArrays(GL_TRIANGLES, 0, 3);
    }
    glBindFramebuffer(GL_FRAMEBUFFER, target);
    glViewport(viewport[0], viewport[1], targetSize.width(), targetSize.height());
    glUseProgram(mixProgram);
    glUniformMatrix4fv(glGetUniformLocation(mixProgram, "transform"), 1, GL_FALSE, outputTransform.constData());
    glActiveTexture(GL_TEXTURE0); glBindTexture(GL_TEXTURE_2D, source);
    glActiveTexture(GL_TEXTURE1); glBindTexture(GL_TEXTURE_2D, textures[1]);
    glUniform1i(glGetUniformLocation(mixProgram, "source"), 0);
    glUniform1i(glGetUniformLocation(mixProgram, "blurred"), 1);
    glUniform1f(glGetUniformLocation(mixProgram, "amount"), amount);
    glUniform1f(glGetUniformLocation(mixProgram, "elapsed"), elapsed);
    glUniform1i(glGetUniformLocation(mixProgram, "transparent"), transparent);
    glUniform4f(glGetUniformLocation(mixProgram, "outputRect"), rect.x(), rect.y(), rect.width(), rect.height());
    std::vector<float> masks;
    for (const auto &r : protectedRects) {
        if (masks.size() >= 64*4) break;
        masks.insert(masks.end(), {float(r.x()), float(r.y()), float(r.width()), float(r.height())});
    }
    glUniform1i(glGetUniformLocation(mixProgram, "protectedCount"), masks.size()/4);
    if (!masks.empty()) glUniform4fv(glGetUniformLocation(mixProgram, "protectedRects"), masks.size()/4, masks.data());
    glDrawArrays(GL_TRIANGLES, 0, 3);

    field.resize(rect.size().toSize());
    if (elapsed < previousElapsed) field.reset();
    previousElapsed = elapsed;
    // The ambient field inherits the wave anchors 1.2 s after the 2.96 s front.
    if (elapsed >= 4.16) field.update(dt, elapsed, cursor - rect.topLeft(), frozen);
    std::vector<float> vertices;
    for (const auto &p : field.points()) {
        if (std::any_of(protectedRects.begin(), protectedRects.end(), [&](const auto &r) {
            return r.adjusted(-3, -3, 3, 3).contains(p.position + rect.topLeft());
        })) continue;
        const double diagonal = p.home.x()/rect.width() + p.home.y()/rect.height();
        const double visibility = std::clamp((elapsed * (2.0/3.2) - diagonal) / 0.08, 0.0, 1.0);
        vertices.insert(vertices.end(), {float(p.position.x()), float(p.position.y()),
            float(p.alpha * visibility * std::min(1.0, amount*2) * 0.55)});
    }
    glUseProgram(pointProgram);
    glUniformMatrix4fv(glGetUniformLocation(pointProgram, "transform"), 1, GL_FALSE, outputTransform.constData());
    glUniform2f(glGetUniformLocation(pointProgram, "extent"), rect.width(), rect.height());
    glUniform1f(glGetUniformLocation(pointProgram, "scale"), targetSize.width()/rect.width());
    glBindBuffer(GL_ARRAY_BUFFER, pointBuffer);
    glBufferData(GL_ARRAY_BUFFER, vertices.size()*sizeof(float), vertices.data(), GL_STREAM_DRAW);
    glEnableVertexAttribArray(0); glVertexAttribPointer(0, 3, GL_FLOAT, GL_FALSE, 3*sizeof(float), nullptr);
    if (desktop) glEnable(GL_PROGRAM_POINT_SIZE);
    glEnable(GL_BLEND); glBlendFunc(GL_ONE, GL_ONE_MINUS_SRC_ALPHA);
    glDrawArrays(GL_POINTS, 0, vertices.size()/3);
    glDisableVertexAttribArray(0);
    auto restore = [](GLenum flag, bool on) { if (on) glEnable(flag); else glDisable(flag); };
    restore(GL_BLEND, blend); restore(GL_SCISSOR_TEST, scissor); restore(GL_DEPTH_TEST, depth);
    restore(GL_STENCIL_TEST, stencil);
    if (desktop) restore(GL_PROGRAM_POINT_SIZE, points);
    glBlendFuncSeparate(blendSrc, blendDst, blendSrcAlpha, blendDstAlpha);
    for (int i = 0; i < 2; ++i) {
        glActiveTexture(GL_TEXTURE0+i);
        glBindTexture(GL_TEXTURE_2D, oldTexture[i]);
        glBindSampler(i, oldSampler[i]);
    }
    glActiveTexture(oldActive); glBindVertexArray(oldVao); glBindBuffer(GL_ARRAY_BUFFER, oldBuffer);
    glUseProgram(oldProgram); glBindFramebuffer(GL_FRAMEBUFFER, target);
    glBindFramebuffer(GL_READ_FRAMEBUFFER, oldRead);
    glViewport(viewport[0], viewport[1], viewport[2], viewport[3]);
}
}
