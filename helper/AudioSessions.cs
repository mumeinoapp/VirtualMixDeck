using System.Diagnostics;
using System.Runtime.InteropServices;

namespace VirtualMixDeck.Helper;

// research/AppVolume.cs で実機検証済みのCOM interopをベースにした
// プロセス単位セッション音量の取得・設定ラッパー。
[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
internal class MMDeviceEnumeratorComObject { }

internal enum EDataFlow { eRender, eCapture, eAll }
internal enum ERole { eConsole, eMultimedia, eCommunications }

[Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDeviceEnumerator
{
    int NotImpl1();
    int GetDefaultAudioEndpoint(EDataFlow dataFlow, ERole role, out IMMDevice ppDevice);
}

[Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IMMDevice
{
    int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
}

[Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionManager2
{
    int NotImpl1();
    int NotImpl2();
    int GetSessionEnumerator(out IAudioSessionEnumerator SessionEnum);
}

[Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionEnumerator
{
    int GetCount(out int SessionCount);
    int GetSession(int SessionCount, out IAudioSessionControl2 Session);
}

[Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface IAudioSessionControl2
{
    int GetState(out int pRetVal);
    int GetDisplayName(out IntPtr pRetVal);
    int SetDisplayName(string Value, ref Guid EventContext);
    int GetIconPath(out IntPtr pRetVal);
    int SetIconPath(string Value, ref Guid EventContext);
    int GetGroupingParam(out Guid pRetVal);
    int SetGroupingParam(ref Guid Override, ref Guid EventContext);
    int RegisterAudioSessionNotification(IntPtr NewNotifications);
    int UnregisterAudioSessionNotification(IntPtr NewNotifications);
    int GetSessionIdentifier(out IntPtr pRetVal);
    int GetSessionInstanceIdentifier(out IntPtr pRetVal);
    int GetProcessId(out int pRetVal);
    int IsSystemSoundsSession();
    int SetDuckingPreference(bool optOut);
}

[Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
internal interface ISimpleAudioVolume
{
    int SetMasterVolume(float fLevel, ref Guid EventContext);
    int GetMasterVolume(out float pfLevel);
    int SetMute(bool bMute, ref Guid EventContext);
    int GetMute(out bool pbMute);
}

public record AudioSessionInfo(int Pid, string ProcessName, float Volume, bool Muted);

public static class AudioSessions
{
    private static readonly Guid IidAudioSessionManager2 = new("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");

    // IAudioSessionControl2 (targetPid にマッチしたもの) と、その表示用ProcessNameを列挙する。
    private static IEnumerable<(IAudioSessionControl2 Control, int Pid)> EnumerateSessions()
    {
        var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
        enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out var device);

        var iid = IidAudioSessionManager2;
        device.Activate(ref iid, 0, IntPtr.Zero, out var o);
        var mgr = (IAudioSessionManager2)o;

        mgr.GetSessionEnumerator(out var sessionEnum);
        sessionEnum.GetCount(out var count);

        for (var i = 0; i < count; i++)
        {
            sessionEnum.GetSession(i, out var ctl);
            ctl.GetProcessId(out var pid);
            if (pid == 0) continue; // システムサウンドセッション等は対象外
            yield return (ctl, pid);
        }
    }

    public static List<AudioSessionInfo> ListSessions()
    {
        var results = new List<AudioSessionInfo>();
        foreach (var (ctl, pid) in EnumerateSessions())
        {
            var vol = (ISimpleAudioVolume)ctl;
            vol.GetMasterVolume(out var level);
            vol.GetMute(out var muted);
            var processName = TryGetProcessName(pid);
            results.Add(new AudioSessionInfo(pid, processName, level, muted));
        }
        return results;
    }

    private static string TryGetProcessName(int pid)
    {
        try
        {
            using var p = Process.GetProcessById(pid);
            return p.ProcessName;
        }
        catch
        {
            return "unknown";
        }
    }

    // processName（拡張子なし、例: "chrome"）にマッチする全セッションへ音量を適用する。
    // 該当セッション数を返す（0なら対象アプリが見つからなかった/未起動）。
    public static int SetVolumeByProcessName(string processName, float level)
    {
        var applied = 0;
        foreach (var (ctl, pid) in EnumerateSessions())
        {
            if (!string.Equals(TryGetProcessName(pid), processName, StringComparison.OrdinalIgnoreCase)) continue;
            var vol = (ISimpleAudioVolume)ctl;
            var ctx = Guid.Empty;
            vol.SetMasterVolume(Math.Clamp(level, 0f, 1f), ref ctx);
            applied++;
        }
        return applied;
    }

    // processNameにマッチする最初のセッションの音量/ミュート状態を返す（見つからなければnull）。
    public static AudioSessionInfo? GetVolumeByProcessName(string processName)
    {
        foreach (var (ctl, pid) in EnumerateSessions())
        {
            if (!string.Equals(TryGetProcessName(pid), processName, StringComparison.OrdinalIgnoreCase)) continue;
            var vol = (ISimpleAudioVolume)ctl;
            vol.GetMasterVolume(out var level);
            vol.GetMute(out var muted);
            return new AudioSessionInfo(pid, processName, level, muted);
        }
        return null;
    }

    public static int SetMuteByProcessName(string processName, bool mute)
    {
        var applied = 0;
        foreach (var (ctl, pid) in EnumerateSessions())
        {
            if (!string.Equals(TryGetProcessName(pid), processName, StringComparison.OrdinalIgnoreCase)) continue;
            var vol = (ISimpleAudioVolume)ctl;
            var ctx = Guid.Empty;
            vol.SetMute(mute, ref ctx);
            applied++;
        }
        return applied;
    }
}
