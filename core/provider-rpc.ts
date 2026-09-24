import crossSpawn from "cross-spawn";
import { StringDecoder } from "node:string_decoder";
import { spawn } from "node:child_process";

/** Line-delimited RPC transport. Unknown requests are rejected, never silently approved. */
export class ProviderRpc {
  private child;
  private sequence = 0;
  private pending = new Map<number, {resolve:(value:any)=>void; reject:(error:Error)=>void}>();
  private failure?: Error;
  private stderr = "";
  private abort: () => void;
  private signal: AbortSignal;
  onFailure: (error:Error)=>void = () => {};
  onNotification: (method:string, params:any)=>void = () => {};
  onRequest: (method:string, params:any)=>Promise<unknown> = async method => { throw new Error(`Unsupported provider request: ${method}`); };
  constructor(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal) {
    this.signal = signal;
    this.child = crossSpawn(executable,args,{cwd,env,stdio:["pipe","pipe","pipe"],detached:process.platform!=="win32",windowsHide:true});
    let buffer = ""; const decoder = new StringDecoder("utf8");
    this.child.stdout?.on("data", chunk => {
      buffer += decoder.write(chunk);
      if (buffer.length > 4*1024*1024) { this.fail(new Error("Provider response exceeded 4 MiB")); this.close(); return; }
      let end;
      while ((end=buffer.indexOf("\n"))>=0) {
        const line=buffer.slice(0,end); buffer=buffer.slice(end+1);
        if (!line.trim()) continue;
        try { this.receive(JSON.parse(line)); } catch { this.fail(new Error("Invalid provider protocol response")); this.close(); }
      }
    });
    this.child.stderr?.on("data", chunk => { this.stderr=(this.stderr+String(chunk)).slice(-3000); });
    this.child.on("error", error=>this.fail(error));
    this.child.on("close",()=>this.fail(new Error(this.stderr.trim() || "Provider connection closed")));
    this.child.stdin?.on("error",error=>this.fail(error));
    this.abort = () => { this.fail(new Error("Run cancelled")); this.close(); };
    signal.addEventListener("abort",this.abort,{once:true});
    if(signal.aborted) this.abort();
  }
  private fail(error: Error) { if(!this.failure) this.onFailure(error); this.failure ||= error; for(const p of this.pending.values()) p.reject(error); this.pending.clear(); }
  private send(value: unknown) { if(!this.failure) this.child.stdin?.write(JSON.stringify(value)+"\n"); }
  private receive(message: any) {
    if(message.method && message.id !== undefined) {
      void this.onRequest(message.method,message.params || {}).then(result=>this.send({jsonrpc:"2.0",id:message.id,result}),error=>this.send({jsonrpc:"2.0",id:message.id,error:{code:-32601,message:String(error)}}));
    } else if(message.method) this.onNotification(message.method,message.params || {});
    else {
      const pending=this.pending.get(message.id); if(!pending) return;
      this.pending.delete(message.id);
      if(message.error) pending.reject(new Error(message.error.message || JSON.stringify(message.error))); else pending.resolve(message.result);
    }
  }
  request(method:string,params:unknown):Promise<any> {
    if(this.failure) return Promise.reject(this.failure);
    const id=++this.sequence;
    return new Promise((resolve,reject)=>{this.pending.set(id,{resolve,reject});this.send({jsonrpc:"2.0",id,method,params});});
  }
  notify(method:string,params:unknown={}) { this.send({jsonrpc:"2.0",method,params}); }
  close() {
    this.signal.removeEventListener("abort",this.abort);
    this.fail(new Error("Provider connection closed"));
    const pid=this.child.pid;
    if(!pid) return;
    try {
      if(process.platform==="win32") spawn("taskkill",["/pid",String(pid),"/T","/F"],{windowsHide:true,stdio:"ignore"});
      else { process.kill(-pid,"SIGTERM"); const timer=setTimeout(()=>{try{process.kill(-pid,"SIGKILL");}catch{}},1500); timer.unref(); this.child.once("close",()=>clearTimeout(timer)); }
    } catch { this.child.kill(); }
  }
}
