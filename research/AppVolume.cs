using System;
using System.Runtime.InteropServices;

namespace AppVolume
{
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

    public class Controller
    {
        static Guid IID_IAudioSessionManager2 = new Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F");

        public static void SetVolumeForProcess(int targetPid, float level)
        {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDevice device;
            enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device);

            object o;
            var iid = IID_IAudioSessionManager2;
            device.Activate(ref iid, 0, IntPtr.Zero, out o);
            var mgr = (IAudioSessionManager2)o;

            IAudioSessionEnumerator sessionEnum;
            mgr.GetSessionEnumerator(out sessionEnum);
            int count;
            sessionEnum.GetCount(out count);

            for (int i = 0; i < count; i++)
            {
                IAudioSessionControl2 ctl;
                sessionEnum.GetSession(i, out ctl);
                int pid;
                ctl.GetProcessId(out pid);
                if (pid == targetPid)
                {
                    var vol = (ISimpleAudioVolume)ctl;
                    Guid ctx = Guid.Empty;
                    vol.SetMasterVolume(level, ref ctx);
                    Console.WriteLine("Set PID " + pid + " volume to " + level);
                }
            }
        }

        public static void ListSessions()
        {
            var enumerator = (IMMDeviceEnumerator)new MMDeviceEnumeratorComObject();
            IMMDevice device;
            enumerator.GetDefaultAudioEndpoint(EDataFlow.eRender, ERole.eMultimedia, out device);

            object o;
            var iid = IID_IAudioSessionManager2;
            device.Activate(ref iid, 0, IntPtr.Zero, out o);
            var mgr = (IAudioSessionManager2)o;

            IAudioSessionEnumerator sessionEnum;
            mgr.GetSessionEnumerator(out sessionEnum);
            int count;
            sessionEnum.GetCount(out count);

            for (int i = 0; i < count; i++)
            {
                IAudioSessionControl2 ctl;
                sessionEnum.GetSession(i, out ctl);
                int pid;
                ctl.GetProcessId(out pid);
                int state;
                ctl.GetState(out state);
                var vol = (ISimpleAudioVolume)ctl;
                float level;
                vol.GetMasterVolume(out level);
                Console.WriteLine(pid + "\t" + state + "\t" + level);
            }
        }
    }
}
