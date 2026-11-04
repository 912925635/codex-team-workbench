$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new()
# Read-only documented APIs on the existing control socket. History requires
# a verified parent chain to the explicitly bound root before any body is read.
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
  public static async Task<string> Run(string path, string[] threadIds, string mode, string rootId, string cursor, string expectedPath) {
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
    await Send(new {id=1,method="initialize",@params=new {clientInfo=new {name="team_workbench_readonly",version="0.5.4"}}});
    using var init=await Response(1);
    if(init.RootElement.TryGetProperty("error",out var initErr)) throw new IOException("initialize RPC error " + initErr.GetProperty("code").GetRawText());
    await Send(new {method="initialized",@params=new {}});
    var results=new System.Collections.Generic.List<object>();
    var rows=new System.Collections.Generic.Dictionary<string,JsonElement>();int next=2;
    foreach(var id in threadIds) {
      await Send(new {id=next,method="thread/read",@params=new {threadId=id,includeTurns=false}});
      using var response=await Response(next++);var root=response.RootElement;
      if(root.TryGetProperty("error",out var error)) results.Add(new {id=id,metadataAvailable=false});
      else { var thread=root.GetProperty("result").GetProperty("thread");
        if(thread.GetProperty("id").GetString()!=id) throw new IOException("thread/read identity mismatch");
        rows[id]=thread.Clone();
        var fields=new System.Collections.Generic.Dictionary<string,JsonElement>();foreach(var name in new[]{"id","source","parentThreadId"}) if(thread.TryGetProperty(name,out var val)) fields[name]=val.Clone(); results.Add(fields); }
    }
    if(mode=="history") {
      string target=threadIds[0], current=target;
      var visited=new System.Collections.Generic.HashSet<string>();
      if(!rows.ContainsKey(rootId))throw new IOException("Bound root metadata unavailable");
      while(current!=rootId) {
        if(!visited.Add(current) || !rows.TryGetValue(current,out var row) || !row.TryGetProperty("parentThreadId",out var p) || p.ValueKind!=JsonValueKind.String)throw new IOException("Exact bound parent chain unavailable");
        string parent=p.GetString();
        if(row.TryGetProperty("source",out var source) && source.ValueKind==JsonValueKind.Object && source.TryGetProperty("subAgent",out var sub) && sub.TryGetProperty("thread_spawn",out var spawn)) {
          if(spawn.TryGetProperty("parent_thread_id",out var declared) && declared.GetString()!=parent)throw new IOException("Conflicting parent metadata");
          if(current==target && !String.IsNullOrEmpty(expectedPath) && spawn.TryGetProperty("agent_path",out var agentPath) && agentPath.GetString()!=expectedPath)throw new IOException("Runtime path mismatch");
        }
        current=parent;
      }
      var args=new System.Collections.Generic.Dictionary<string,object>{{"threadId",target},{"limit",1},{"sortDirection","desc"},{"itemsView","full"}};
      if(!String.IsNullOrEmpty(cursor))args["cursor"]=cursor;
      await Send(new{id=next,method="thread/turns/list",@params=args});
      using var page=await Response(next);var response=page.RootElement;
      if(response.TryGetProperty("error",out var pageError))throw new IOException("thread/turns/list RPC error " + pageError.GetProperty("code").GetRawText());
      var data=response.GetProperty("result");var turns=new System.Collections.Generic.List<object>();
      bool truncated=false;int omitted=0, textBudget=8000;
      foreach(var turn in data.GetProperty("data").EnumerateArray()) {
        if(turns.Count>=1){truncated=true;break;}
        var items=new System.Collections.Generic.List<object>();
        if(turn.TryGetProperty("items",out var all))foreach(var item in all.EnumerateArray()) {
          string type=item.GetProperty("type").GetString(), body="";
          if(type!="userMessage" && type!="agentMessage"){omitted++;continue;}
          if(items.Count>=20 || textBudget<=0){truncated=true;omitted++;continue;}
          if(item.TryGetProperty("text",out var t) && t.ValueKind==JsonValueKind.String)body=t.GetString();
          else if(type=="userMessage" && item.TryGetProperty("content",out var content) && content.ValueKind==JsonValueKind.Array) {
            var text=new StringBuilder();foreach(var part in content.EnumerateArray())
              if(part.TryGetProperty("type",out var pt) && pt.GetString()=="text" && part.TryGetProperty("text",out var value) && value.ValueKind==JsonValueKind.String)text.AppendLine(value.GetString());
            body=text.ToString();
          }
          if(String.IsNullOrWhiteSpace(body)){omitted++;continue;}
          int maxText=Math.Min(1000,textBudget);
          if(body.Length>maxText){body=body.Substring(0,maxText);truncated=true;}
          textBudget-=body.Length;
          items.Add(new{id=item.GetProperty("id").GetString(),type,text=body});
        }
        turns.Add(new{id=turn.GetProperty("id").GetString(),status=turn.GetProperty("status").GetString(),items});
      }
      string nextCursor=data.TryGetProperty("nextCursor",out var nc) && nc.ValueKind==JsonValueKind.String ? nc.GetString() : null;
      return JsonSerializer.Serialize(new{connected=true,threads=results,threadId=target,turns,nextCursor,truncated,omittedItems=omitted,sourceTool="app-server.thread/turns/list"});
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
  $mode=if($inputData.mode){[string]$inputData.mode}else{'metadata'}
  if($mode -notin @('metadata','history')){throw 'Unsupported read operation'}
  if($mode -eq 'history'){
    $rootId=[string]$inputData.rootThreadId
    $parsed=[guid]::Empty
    if(-not [guid]::TryParseExact($rootId,'D',[ref]$parsed) -or $rootId -notin $ids){throw 'Invalid bound root'}
    if(([string]$inputData.cursor).Length -gt 4096){throw 'Invalid page cursor'}
  }
  $codexHome=if($env:CODEX_HOME){$env:CODEX_HOME}else{Join-Path $env:USERPROFILE '.codex'}
  [WorkbenchMetadataReader]::Run((Join-Path $codexHome 'app-server-control/app-server-control.sock'),[string[]]$ids,$mode,[string]$inputData.rootThreadId,[string]$inputData.cursor,[string]$inputData.runtimeRef).GetAwaiter().GetResult()
} catch {
  @{connected=$false;error='PUBLIC_READ_UNAVAILABLE';message=$_.Exception.GetBaseException().Message} | ConvertTo-Json -Compress
  exit 1
}
