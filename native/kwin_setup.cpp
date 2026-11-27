// SPDX-License-Identifier: GPL-2.0-or-later
// Unprivileged bootstrap + a deliberately small atomic, fixed-destination install.
#include <QCoreApplication>
#include <QCryptographicHash>
#include <QFile>
#include <QFileInfo>
#include <QLibraryInfo>
#include <QProcess>
#include <QSaveFile>
#include <QStandardPaths>
#include <QTemporaryDir>
#include <QDir>
#include <QDebug>
#include <QJsonDocument>
#include <QJsonObject>
#include <QTextStream>
#include <unistd.h>

static QString destination()
{
    return QLibraryInfo::path(QLibraryInfo::PluginsPath)
        + "/kwin/effects/plugins/focusglass.so";
}

static QByteArray digest(const QString &path)
{
    QFile file(path);
    if (!file.open(QIODevice::ReadOnly)) return {};
    QCryptographicHash hash(QCryptographicHash::Sha256);
    if (!hash.addData(&file)) return {};
    return hash.result();
}

static bool run(const QString &program, const QStringList &args, QByteArray *output = nullptr,
                int timeout = 15000)
{
    QProcess process;
    process.start(program, args);
    if (!process.waitForStarted(5000)) return false;
    if (!process.waitForFinished(timeout)) {
        process.kill();
        process.waitForFinished();
        return false;
    }
    if (output) *output = process.readAllStandardOutput();
    if (process.exitStatus() != QProcess::NormalExit || process.exitCode() != 0) {
        qWarning().noquote() << process.readAllStandardError();
        return false;
    }
    return true;
}

static int installPlugin(const QString &source)
{
    if (geteuid() != 0) {
        qCritical() << "Plugin installation requires administrator authorization.";
        return 1;
    }
    QFile input(source);
    if (!input.open(QIODevice::ReadOnly) || input.size() < 4 || input.size() > 64*1024*1024
        || input.peek(4) != QByteArray("\x7f" "ELF",4)) {
        qCritical() << "Invalid native effect binary.";
        return 1;
    }
    // Never truncate a .so that the compositor might still have mapped.
    const QString target = destination();
    if (QFileInfo(target).isSymLink() || !QDir().mkpath(QFileInfo(target).absolutePath())) {
        qCritical() << "Cannot safely create plugin destination:" << target;
        return 1;
    }
    QSaveFile output(target);
    if (!output.open(QIODevice::WriteOnly)) {
        qCritical() << output.errorString();
        return 1;
    }
    const QByteArray bytes = input.readAll();
    if (bytes.size() != input.size() || output.write(bytes) != bytes.size()
        || !output.setPermissions(QFile::ReadOwner|QFile::WriteOwner|QFile::ExeOwner
            |QFile::ReadGroup|QFile::ExeGroup|QFile::ReadOther|QFile::ExeOther)
        || !output.commit()) {
        qCritical() << "Atomic plugin installation failed:" << output.errorString();
        return 1;
    }
    return 0;
}

int main(int argc, char **argv)
{
    QCoreApplication app(argc,argv);
    QCoreApplication::setApplicationName("FocusGlass native effect setup");
    const auto args = app.arguments();
    if (args.size() == 2 && args[1] == "--build-info") {
        QTextStream(stdout) << QJsonDocument(QJsonObject{
            {"kwinVersion",FOCUSGLASS_KWIN_VERSION},{"destination",destination()}})
            .toJson(QJsonDocument::Compact) << '\n';
        return 0;
    }
    if (args.size() != 3) return 2;
    const QString source = QFileInfo(args[2]).canonicalFilePath();
    if (source.isEmpty()) {
        qCritical() << "Bundled FocusGlass KWin plugin is missing.";
        return 1;
    }
    if (args[1] == "--install-plugin") return installPlugin(source);
    if (args[1] != "--ensure-kwin") return 2;

    QString dbus = QStandardPaths::findExecutable("qdbus6");
    if (dbus.isEmpty()) dbus = QStandardPaths::findExecutable("qdbus");
    if (dbus.isEmpty()) dbus = QStandardPaths::findExecutable("qdbus-qt6");
    if (dbus.isEmpty()) {
        const QString bundled = QLibraryInfo::path(QLibraryInfo::BinariesPath)+"/qdbus";
        if (QFileInfo(bundled).isExecutable()) dbus = bundled;
    }
    QByteArray support;
    if (dbus.isEmpty() || !run(dbus,{"org.kde.KWin","/KWin","org.kde.KWin.supportInformation"},&support)) {
        qCritical() << "Automatic native blur setup requires a running KDE KWin session.";
        return 1;
    }
    const QByteArray version = QByteArray("KWin version: ") + FOCUSGLASS_KWIN_VERSION;
    if (!support.split('\n').contains(version)) {
        qCritical() << "KWin ABI mismatch. This FocusGlass package requires KWin"
                    << FOCUSGLASS_KWIN_VERSION << "; install a matching FocusGlass package.";
        return 1;
    }
    auto effect = [&](const QString &operation, QByteArray *reply = nullptr) {
        return run(dbus,{"org.kde.KWin","/Effects","org.kde.kwin.Effects."+operation,"focusglass"},reply);
    };
    const auto sourceHash = digest(source);
    if (sourceHash.isEmpty()) return 1;
    QByteArray loaded;
    if (!effect("isEffectLoaded",&loaded)) return 1;
    if (sourceHash != digest(destination())) {
        // Unload before installation; replacement itself is atomic as a second
        // safeguard. Do not reload an unsafe old effect if authorization fails.
        if (loaded.trimmed() == "true" && !effect("unloadEffect")) return 1;
        const QString pkexec = QStandardPaths::findExecutable("pkexec");
        if (pkexec.isEmpty()) {
            qCritical() << "Polkit is unavailable. Install FocusGlass through the system package manager.";
            return 1;
        }
        qInfo() << "FocusGlass needs authorization to install/update its KWin effect.";
        // Root may not access a user's AppImage FUSE mount. Stage regular files
        // in a private runtime directory before asking Polkit for authorization.
        QString runtime = QStandardPaths::writableLocation(QStandardPaths::RuntimeLocation);
        if (runtime.isEmpty()) runtime = QDir::tempPath();
        QTemporaryDir staging(runtime+"/focusglass-setup-XXXXXX");
        const QString stagedHelper = staging.path()+"/focusglass-native-setup";
        const QString stagedPlugin = staging.path()+"/focusglass.so";
        if (!staging.isValid()
            || !QFile::copy(QCoreApplication::applicationFilePath(),stagedHelper)
            || !QFile::copy(source,stagedPlugin)) {
            qCritical() << "Cannot stage the native effect installer.";
            return 1;
        }
        if (!run(pkexec,{stagedHelper,"--install-plugin",stagedPlugin},nullptr,180000)) {
            qCritical() << "Native effect installation was cancelled or failed; blur remains disabled.";
            return 1;
        }
        if (digest(destination()) != sourceHash) {
            qCritical() << "Installed effect verification failed.";
            return 1;
        }
        loaded = "false";
    }
    if (loaded.trimmed() != "true") {
        QByteArray result;
        if (!effect("loadEffect",&result) || result.trimmed() != "true") {
            qCritical() << "KWin could not load the FocusGlass effect.";
            return 1;
        }
    }
    qInfo() << "FocusGlass native effect is installed and loaded.";
    return 0;
}
