#include <QGuiApplication>
#include <QWindow>
#include <QBackingStore>
#include <QPainter>
#include <QLocalSocket>
#include <QTimer>
#include "effect_core.h"
#ifdef FG_HAVE_KWINDOWSYSTEM
#include <KWindowEffects>
#endif

class Pattern final : public QWindow {
public:
    Pattern() : backing(this) { resize(400,300); }
protected:
    void exposeEvent(QExposeEvent *) override {
        if (!isExposed()) return;
        backing.resize(size());
        backing.beginPaint(QRect(QPoint(),size()));
        QPainter painter(backing.paintDevice());
        for (int y=0;y<height();y+=8) for (int x=0;x<width();x+=8) {
            painter.fillRect(x,y,8,8,(x/8+y/8)%2 ? Qt::white : Qt::black);
        }
        painter.fillRect(0,0,width(),20,Qt::red);
        painter.fillRect(0,height()-20,width(),20,Qt::green);
        painter.end();
        backing.endPaint();
        backing.flush(QRect(QPoint(),size()));
    }
private:
    QBackingStore backing;
};

int main(int argc,char **argv)
{
    QGuiApplication app(argc,argv);
    const bool controls = app.arguments().contains("--controls");
    app.setDesktopFileName(controls ? "com.neurotech.focusglass.fixture" : "org.example.pattern");
    Pattern pattern;
    pattern.setTitle(controls ? "FocusGlass controls fixture" : "Foreign checkerboard fixture");
    if (controls) pattern.resize(240,180);
    pattern.show();
#ifdef FG_HAVE_KWINDOWSYSTEM
    if (app.arguments().contains("--glass")) {
        pattern.setOpacity(0.9);
        KWindowEffects::enableBlurBehind(&pattern,true);
    }
#endif
    QLocalSocket socket;
    if (controls) {
        QTimer::singleShot(700, [&] {
            socket.connectToServer(FocusGlass::socketPath());
        });
        QObject::connect(&socket,&QLocalSocket::connected,[&] {
            socket.write(app.arguments().contains("--diagnose")
                ? "{\"op\":\"diagnose\"}\n" : "{\"op\":\"preview\"}\n");
        });
    }
    return app.exec();
}
