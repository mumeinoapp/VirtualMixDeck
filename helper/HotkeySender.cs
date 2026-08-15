using System.Runtime.InteropServices;

namespace VirtualMixDeck.Helper;

public static class HotkeySender
{
    private const int InputKeyboard = 1;
    private const uint KeyEventFKeyup = 0x0002;

    [StructLayout(LayoutKind.Sequential)]
    private struct KeybdInput
    {
        public ushort wVk;
        public ushort wScan;
        public uint dwFlags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    // ネイティブ側のINPUT共用体はMOUSEINPUT（x64で28バイト）が最大サイズであり、
    // cbSizeにはネイティブのsizeof(INPUT)と一致する値を渡す必要がある。KEYBDINPUTだけを
    // 定義すると共用体が24バイトになりネイティブ側とサイズがずれ、SendInputが
    // ERROR_INVALID_PARAMETER(87)で失敗する（実機で確認）ため、Sizeを明示的に28に合わせる。
    [StructLayout(LayoutKind.Explicit, Size = 28)]
    private struct InputUnion
    {
        [FieldOffset(0)] public KeybdInput ki;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct Input
    {
        public int type;
        public InputUnion u;
    }

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint SendInput(uint nInputs, Input[] pInputs, int cbSize);

    private static readonly Dictionary<string, ushort> KeyMap = new(StringComparer.OrdinalIgnoreCase)
    {
        ["ctrl"] = 0x11, ["control"] = 0x11,
        ["alt"] = 0x12,
        ["shift"] = 0x10,
        ["win"] = 0x5B, ["windows"] = 0x5B,
        ["enter"] = 0x0D, ["return"] = 0x0D,
        ["esc"] = 0x1B, ["escape"] = 0x1B,
        ["tab"] = 0x09,
        ["space"] = 0x20,
        ["backspace"] = 0x08,
        ["delete"] = 0x2E,
        ["up"] = 0x26, ["down"] = 0x28, ["left"] = 0x25, ["right"] = 0x27,
        ["home"] = 0x24, ["end"] = 0x23, ["pageup"] = 0x21, ["pagedown"] = 0x22,
    };

    // "ctrl+shift+a" のような文字列をキー入力として送信する。
    // 単一文字（a-z, 0-9）・上記KeyMapの名前・F1〜F24に対応。
    public static bool Send(string combo)
    {
        var parts = combo.Split('+', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
        if (parts.Length == 0) return false;

        var vks = new List<ushort>();
        foreach (var part in parts)
        {
            if (KeyMap.TryGetValue(part, out var vk))
            {
                vks.Add(vk);
            }
            else if (part.Length == 1 && (char.IsLetterOrDigit(part[0])))
            {
                vks.Add((ushort)char.ToUpperInvariant(part[0]));
            }
            else if (part.Length is 2 or 3 && part[0] is 'f' or 'F' && int.TryParse(part.AsSpan(1), out var fn) && fn is >= 1 and <= 24)
            {
                vks.Add((ushort)(0x70 + (fn - 1))); // VK_F1 = 0x70
            }
            else
            {
                return false; // 未知のキー名
            }
        }

        var downs = vks.Select(vk => MakeInput(vk, false)).ToArray();
        var ups = vks.AsEnumerable().Reverse().Select(vk => MakeInput(vk, true)).ToArray();
        var all = downs.Concat(ups).ToArray();

        var sent = SendInput((uint)all.Length, all, Marshal.SizeOf<Input>());
        if (sent != all.Length)
        {
            var err = Marshal.GetLastWin32Error();
            throw new InvalidOperationException($"SendInput失敗: sent={sent}/{all.Length}, GetLastError={err}");
        }
        return true;
    }

    private static Input MakeInput(ushort vk, bool keyUp) => new()
    {
        type = InputKeyboard,
        u = new InputUnion
        {
            ki = new KeybdInput
            {
                wVk = vk,
                wScan = 0,
                dwFlags = keyUp ? KeyEventFKeyup : 0,
                time = 0,
                dwExtraInfo = IntPtr.Zero,
            },
        },
    };
}
