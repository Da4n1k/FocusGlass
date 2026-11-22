#include "effect_core.h"
#include <QGuiApplication>
#include <QOffscreenSurface>
#include <QOpenGLContext>
#include <QSurfaceFormat>
#include <QDebug>
#include <cmath>
#include <stdexcept>

static void require(bool condition, const char *message)
{
    if (!condition) throw std::runtime_error(message);
}

int main(int argc, char **argv)
{
    QSurfaceFormat format;
    format.setVersion(3, 3); format.setProfile(QSurfaceFormat::CoreProfile);
    QSurfaceFormat::setDefaultFormat(format);
    QGuiApplication app(argc, argv);
    QOffscreenSurface surface;
    surface.setFormat(format); surface.create();
    QOpenGLContext context;
    context.setFormat(format);
    if (!context.create() || !context.makeCurrent(&surface)) {
        qCritical() << "OpenGL 3.3 context unavailable"; return 1;
    }
    try {
        constexpr int width = 128, height = 128;
        std::vector<unsigned char> source(width*height*4);
        for (int y = 0; y < height; ++y) for (int x = 0; x < width; ++x) {
            const int i = (y*width+x)*4;
            const int value = ((x/4+y/4)%2) ? 230 : 25;
            source[i] = value; source[i+1] = value; source[i+2] = value; source[i+3] = 255;
        }
        GLuint textures[2]{}, fbos[2]{};
        glGenTextures(2, textures); glGenFramebuffers(2, fbos);
        for (int i = 0; i < 2; ++i) {
            glBindTexture(GL_TEXTURE_2D, textures[i]);
            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA8, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, source.data());
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
            glBindFramebuffer(GL_FRAMEBUFFER, fbos[i]);
            glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, textures[i], 0);
            require(glCheckFramebufferStatus(GL_FRAMEBUFFER) == GL_FRAMEBUFFER_COMPLETE, "FBO incomplete");
        }
        FocusGlass::Renderer renderer;
        QString error;
        require(renderer.initialize(error), qPrintable(error));
        auto render = [&](double radius) {
            glBindFramebuffer(GL_READ_FRAMEBUFFER, fbos[0]);
            glBindFramebuffer(GL_DRAW_FRAMEBUFFER, fbos[1]);
            glBlitFramebuffer(0, 0, width, height, 0, 0, width, height, GL_COLOR_BUFFER_BIT, GL_NEAREST);
            glBindFramebuffer(GL_FRAMEBUFFER, fbos[1]);
            glViewport(0, 0, width, height);
            renderer.render(textures[0], {width,height}, {0,0,width,height}, {width,height},
                {{0,0,64,height}}, 1, radius, 0.1, {-9999,-9999}, 0.016, false, false);
            std::vector<unsigned char> output(source.size());
            glReadPixels(0, 0, width, height, GL_RGBA, GL_UNSIGNED_BYTE, output.data());
            require(glGetError() == GL_NO_ERROR, "GL error during real shader render");
            return output;
        };
        const auto mild = render(1);
        const auto strong = render(8);
        int unchanged = 0;
        double before = 0, afterMild = 0, afterStrong = 0;
        for (int y = 8; y < height-8; ++y) for (int x = 8; x < width-8; ++x) {
            const auto i = (y*width+x)*4;
            if (x < 60) {
                require(strong[i] == source[i], "Protected application region was blurred");
                ++unchanged;
            } else if (x > 70) {
                before += std::abs(int(source[i])-int(source[i+4]));
                afterMild += std::abs(int(mild[i])-int(mild[i+4]));
                afterStrong += std::abs(int(strong[i])-int(strong[i+4]));
            }
        }
        require(afterMild < before, "Shader did not blur the source");
        require(afterStrong < afterMild*0.8, "Radius slider does not affect actual blur");
        require(afterStrong < before*0.1, "Strong blur retains a sharp ghost of the original scene");
        FocusGlass::ParticleField field;
        FocusGlass::ParticleField reference;
        field.resize({400,300});
        reference.resize({400,300});
        require(!field.points().empty(), "No particles generated");
        const auto home = field.points().front().home;
        const auto cursor = home - QPointF(20,0);
        for (int i = 0; i < 120; ++i) {
            field.update(1.0/60, 4, cursor, false);
            reference.update(1.0/60, 4, {-9999,-9999}, false);
        }
        const auto pushed = field.points().front().position;
        qInfo() << "Particle home / cursor / repelled:" << home << cursor << pushed;
        auto distance = [](QPointF p) { return std::hypot(p.x(),p.y()); };
        require(distance(pushed-cursor) > distance(reference.points().front().position-cursor)+10,
            "Cursor did not repel particles relative to the identical no-cursor simulation");
        field.update(1, 8, {-9999,-9999}, true);
        require(field.points().front().position == pushed, "Artifact freeze moved particles");
        for (int i = 0; i < 600; ++i) field.update(1.0/60, 4, {-9999,-9999}, false);
        const auto returned = field.points().front().position - home;
        require(std::hypot(returned.x(), returned.y()) < 19, "Particle did not return to its anchor");
        qInfo().noquote() << "GPU:" << reinterpret_cast<const char *>(glGetString(GL_RENDERER));
        qInfo() << "PASS: real blur, radius response, protected pixels:" << unchanged
                << "edge energy:" << before << afterMild << afterStrong;
        qInfo() << "PASS: particle repulsion, spring return, artifact freeze";
        glDeleteFramebuffers(2, fbos); glDeleteTextures(2, textures);
    } catch (const std::exception &error) {
        qCritical() << "FAIL:" << error.what(); return 1;
    }
    return 0;
}
