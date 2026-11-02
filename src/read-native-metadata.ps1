$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
# Only documented existing control socket and thread/read metadata; no history or mutation.
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
public static class WorkbenchMetadataReader {
  public static async Task<string> Run(string path, string[] threadIds) {
    using var deadline = new CancellationTokenSource(TimeSpan.FromSeconds(15));
    using var socket = new Socket(AddressFamily.Unix, SocketType.Stream, ProtocolType.Unspecified);
    await socket.ConnectAsync(new UnixDomainSocketEndPoint(path), deadline.Token);
    using var stream = new NetworkStream(socket, false);
    string key = Convert.ToBase64String(System.Security.Cryptography.RandomNumberGenerator.GetBytes(16));
    string request = "GET / HTTP/1.1\r\nHost: localhost\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: " + key + "\r\nSec-WebSocket-Version: 13\r\n\r\n";
    await stream.WriteAsync(Encoding.ASCII.GetBytes(request), deadline.Token);
    var header = new StringBuilder(); var one = new byte[1];
    while (!header.ToString().EndsWith("\r\n\r\n")) {
      if (header.Length > 8192 || await stream.ReadAsync(one, deadline.Token) == 0) throw new IOException("Invalid HTTP upgrade");
      header.Append((char)one[0]);
    }
    if (!header.ToString().StartsWith("HTTP/1.1 101")) throw new IOException("WebSocket upgrade rejected: " + header.ToString().Split('\r')[0]);
    using var ws = WebSocket.CreateFromStream(stream, false, null, TimeSpan.FromSeconds(30));
    async Task Send(object obj) { var bytes=JsonSerializer.SerializeToUtf8Bytes(obj); await ws.SendAsync(bytes.AsMemory(), WebSocketMessageType.Text, true, deadline.Token); }
    async Task<JsonDocument> Response(int id) {
      var buffer=new byte[8192];
      for (;;) {
        using var message = new MemoryStream(); WebSocketReceiveResult r;
        do { r=await ws.ReceiveAsync(new ArraySegment<byte>(buffer),deadline.Token); if (r.MessageType==WebSocketMessageType.Close) throw new IOException("Server closed"); message.Write(buffer,0,r.Count); if(message.Length>1048576) throw new IOException("Message exceeds probe limit"); } while(!r.EndOfMessage);
        var doc=JsonDocument.Parse(message.ToArray());
        if(doc.RootElement.TryGetProperty("id",out var rid) && rid.ValueKind==JsonValueKind.Number && rid.GetInt32()==id) return doc;
        doc.Dispose(); // Unrequested notifications are neither retained nor printed.
      }
    }
    await Send(new {id=1,method="initialize",@params=new {clientInfo=new {name="team_workbench_readonly_probe",version="0.5.1"}}});
    using var init=await Response(1);
    if(init.RootElement.TryGetProperty("error",out var initErr)) return JsonSerializer.Serialize(new {stage="initialize",error=initErr});
    await Send(new {method="initialized",@params=new {}});
    var results=new System.Collections.Generic.List<object>();int next=2;
    foreach(var id in threadIds) {
      await Send(new {id=next,method="thread/read",@params=new {threadId=id,includeTurns=false}});
      using var response=await Response(next++);var root=response.RootElement;
      if(root.TryGetProperty("error",out var error)) results.Add(new {id=id,metadataAvailable=false});
      else { var thread=root.GetProperty("result").GetProperty("thread");var fields=new System.Collections.Generic.Dictionary<string,JsonElement>();foreach(var name in new[]{"id","source","parentThreadId"}) if(thread.TryGetProperty(name,out var val)) fields[name]=val.Clone(); results.Add(fields); }
    }
    return JsonSerializer.Serialize(new {connected=true,threads=results});
  }
}
'@

try {
  $inputData=[Console]::In.ReadToEnd() | ConvertFrom-Json
  $ids=@($inputData.threadIds)
  if($ids.Count -lt 1 -or $ids.Count -gt 100){throw 'Invalid bound request'}
  foreach($id in $ids){$parsed=[guid]::Empty;if(-not [guid]::TryParseExact($id,'D',[ref]$parsed)){throw 'Invalid UUID'}}
  $codexHome=if($env:CODEX_HOME){$env:CODEX_HOME}else{Join-Path $env:USERPROFILE '.codex'}
  [WorkbenchMetadataReader]::Run((Join-Path $codexHome 'app-server-control/app-server-control.sock'),[string[]]$ids).GetAwaiter().GetResult()
} catch {
  '{"connected":false,"error":"PUBLIC_METADATA_UNAVAILABLE"}'
  exit 1
}
