// windows-media-ocr — Windows.Media.Ocr Japanese OCR sidecar.
//
// Same protocol as the macOS Apple Vision sidecar:
//   client → sidecar:  [u32-BE length][PNG bytes]
//   sidecar → client:  {"lines":[...],"ts":<unix ms>}\n
//   sidecar → client:  {"error":"..."}\n   (recoverable)
//
// Diagnostics on stderr. Exits cleanly on stdin EOF.
//
// Requires the Japanese language pack to be installed on the user's
// Windows. If missing, the first recognize call emits
// {"error":"ja-language-pack-missing"} and the renderer surfaces a
// settings walkthrough.

using System;
using System.IO;
using System.Net;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Windows.Globalization;
using Windows.Graphics.Imaging;
using Windows.Media.Ocr;
using Windows.Storage.Streams;

namespace VnReader.WindowsMediaOcr;

internal static class Program
{
    private static OcrEngine? _engine;

    private static async Task<int> Main()
    {
        var stdin = Console.OpenStandardInput();
        var stdout = Console.OpenStandardOutput();

        Console.Error.WriteLine("windows-media-ocr ready");

        try
        {
            _engine = OcrEngine.TryCreateFromLanguage(new Language("ja"));
            if (_engine == null)
            {
                await WriteJsonAsync(stdout, new { error = "ja-language-pack-missing" });
                return 1;
            }
        }
        catch (Exception ex)
        {
            await WriteJsonAsync(stdout, new { error = $"engine-init-failed: {ex.Message}" });
            return 1;
        }

        while (true)
        {
            var lengthBytes = await ReadExactAsync(stdin, 4);
            if (lengthBytes == null)
            {
                Console.Error.WriteLine("stdin closed; exiting");
                break;
            }
            var length = (int)IPAddress.NetworkToHostOrder(BitConverter.ToInt32(lengthBytes, 0));
            if (length <= 0 || length > 32_000_000)
            {
                await WriteJsonAsync(stdout, new { error = $"invalid length: {length}" });
                continue;
            }
            var pngBytes = await ReadExactAsync(stdin, length);
            if (pngBytes == null)
            {
                Console.Error.WriteLine("stdin closed mid-frame; exiting");
                break;
            }

            string[] lines;
            try
            {
                lines = await RecognizeAsync(pngBytes);
            }
            catch (Exception ex)
            {
                await WriteJsonAsync(stdout, new { error = ex.Message });
                continue;
            }

            await WriteJsonAsync(stdout, new
            {
                lines,
                ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
            });
        }
        return 0;
    }

    private static async Task<byte[]?> ReadExactAsync(Stream s, int count)
    {
        var buf = new byte[count];
        var got = 0;
        while (got < count)
        {
            var read = await s.ReadAsync(buf.AsMemory(got, count - got));
            if (read == 0) return null;
            got += read;
        }
        return buf;
    }

    private static async Task<string[]> RecognizeAsync(byte[] pngBytes)
    {
        if (_engine == null) throw new InvalidOperationException("engine not initialized");

        using var stream = new InMemoryRandomAccessStream();
        await stream.WriteAsync(pngBytes.AsBuffer());
        stream.Seek(0);

        var decoder = await BitmapDecoder.CreateAsync(stream);
        using var bitmap = await decoder.GetSoftwareBitmapAsync();
        var result = await _engine.RecognizeAsync(bitmap);

        var lines = new string[result.Lines.Count];
        for (int i = 0; i < result.Lines.Count; i++)
        {
            lines[i] = result.Lines[i].Text;
        }
        return lines;
    }

    private static async Task WriteJsonAsync(Stream stdout, object value)
    {
        var json = JsonSerializer.Serialize(value);
        var bytes = Encoding.UTF8.GetBytes(json + "\n");
        await stdout.WriteAsync(bytes);
        await stdout.FlushAsync();
    }
}

// AsBuffer extension: bridges byte[] to IBuffer for InMemoryRandomAccessStream.
internal static class BufferExtensions
{
    public static Windows.Storage.Streams.IBuffer AsBuffer(this byte[] bytes)
        => System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.AsBuffer(bytes);
}
