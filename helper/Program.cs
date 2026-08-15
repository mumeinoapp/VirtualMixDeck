using System.Text.Json;
using System.Text.Json.Serialization;
using VirtualMixDeck.Helper;

// Electron側からstdin経由でJSON1行=1コマンドを受け取り、stdout経由でJSON1行=1レスポンスを返す。
// 対応コマンド: ping / list_sessions / set_volume / set_mute / send_hotkey
// このプロセスは常駐し、標準入力がEOFになったら終了する（Electron側がプロセスをkillする運用も可）。

var jsonOptions = new JsonSerializerOptions
{
    PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
    DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
};

string? line;
while ((line = Console.ReadLine()) != null)
{
    if (string.IsNullOrWhiteSpace(line)) continue;

    string? id = null;
    try
    {
        using var doc = JsonDocument.Parse(line);
        var root = doc.RootElement;
        id = root.TryGetProperty("id", out var idEl) ? idEl.GetString() : null;
        var cmd = root.TryGetProperty("cmd", out var cmdEl) ? cmdEl.GetString() : null;

        object? data = cmd switch
        {
            "ping" => "pong",
            "list_sessions" => AudioSessions.ListSessions(),
            "get_volume" => HandleGetVolume(root),
            "set_volume" => HandleSetVolume(root),
            "set_mute" => HandleSetMute(root),
            "send_hotkey" => HandleSendHotkey(root),
            _ => throw new InvalidOperationException($"未知のコマンド: {cmd}"),
        };

        WriteResponse(new { id, ok = true, data }, jsonOptions);
    }
    catch (Exception ex)
    {
        WriteResponse(new { id, ok = false, error = ex.Message }, jsonOptions);
    }
}

object HandleGetVolume(JsonElement root)
{
    var processName = root.GetProperty("processName").GetString()
        ?? throw new InvalidOperationException("processNameが必要です");
    var info = AudioSessions.GetVolumeByProcessName(processName);
    if (info == null) return new { found = false };
    return new { found = true, level = info.Volume, muted = info.Muted };
}

object HandleSetVolume(JsonElement root)
{
    var processName = root.GetProperty("processName").GetString()
        ?? throw new InvalidOperationException("processNameが必要です");
    var level = root.GetProperty("level").GetSingle();
    var applied = AudioSessions.SetVolumeByProcessName(processName, level);
    return new { applied };
}

object HandleSetMute(JsonElement root)
{
    var processName = root.GetProperty("processName").GetString()
        ?? throw new InvalidOperationException("processNameが必要です");
    var mute = root.GetProperty("mute").GetBoolean();
    var applied = AudioSessions.SetMuteByProcessName(processName, mute);
    return new { applied };
}

object HandleSendHotkey(JsonElement root)
{
    var combo = root.GetProperty("combo").GetString()
        ?? throw new InvalidOperationException("comboが必要です");
    var sent = HotkeySender.Send(combo);
    if (!sent) throw new InvalidOperationException($"キー送信に失敗しました: {combo}");
    return new { sent = true };
}

void WriteResponse(object response, JsonSerializerOptions options)
{
    Console.WriteLine(JsonSerializer.Serialize(response, options));
    Console.Out.Flush();
}
