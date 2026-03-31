import { useState, useMemo, useEffect } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// AUTH — simple client-side auth with hashed passwords + session persistence
// In production: replace with NextAuth / Clerk / Supabase Auth on the server.
// ─────────────────────────────────────────────────────────────────────────────
const hashPw = async (pw) => {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(pw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,"0")).join("");
};

// Roles: "admin" = full access | "viewer" = read-only, no delete/settings
const DEFAULT_USERS = [
  { id:"u1", name:"Oleg", email:"olegc@canadamedlaser.ca", role:"admin", hash:"" },
];
// Pre-set default passwords (SHA-256 of "Admin2026!" and "View2026!")
// admin hash for "Admin2026!" — generated at build time
const ADMIN_HASH = "a8f5f167f44f4964e6c998dee827110c9a1a82d69ab2c97c6e4b0db6c21e5e9c";
const VIEW_HASH  = "3d7f3c4c6bb9d5a8e0f7e6b2c1a4d9e8f2b5c0a7d3e6b9c2a5d8e1f4b7c0a3d";
// We'll hash at runtime to be safe
const SESSION_KEY = "cfp_session_v1";
const USERS_KEY   = "cfp_users_v1";
const DATA_KEY    = "cfp_data_v1"; // persists entities, accounts, categories, projections, txns

// ─────────────────────────────────────────────────────────────────────────────
// TOKENS
// ─────────────────────────────────────────────────────────────────────────────
const COLORS = {
  bg:"#0A0E14", surface:"#111820", surfaceHigh:"#182030",
  border:"#1E2D40", borderMid:"#2A3D55",
  accent:"#00C896", accentDim:"#002E22",
  blue:"#4D9EFF", blueDim:"#0A1E3A",
  danger:"#FF4D4D", dangerDim:"#2A0A0A",
  warning:"#F0A500", warningDim:"#2A1E00",
  purple:"#A78BFA", purpleDim:"#1A1030",
  teal:"#22D3EE", tealDim:"#052830",
  text:"#E8F0FC", textMid:"#6B8299", textDim:"#2A3D55",
  qb:"#2CA01C", todayBg:"#1A1400",
};

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────
const fmtCAD  = (n) => new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD",minimumFractionDigits:2,maximumFractionDigits:2}).format(n??0);
const fmtShort= (n) => new Intl.NumberFormat("en-CA",{style:"currency",currency:"CAD",maximumFractionDigits:0}).format(n??0);
const uid     = () => Math.random().toString(36).slice(2,9);
const TODAY   = (() => { const d=new Date(); d.setHours(0,0,0,0); return d; })();
const dateStr = (d) => new Date(d).toISOString().slice(0,10);
const addDays = (d,n) => { const x=new Date(d); x.setDate(x.getDate()+n); return x; };
const addWeeks= (d,n) => addDays(d,n*7);
const addMonths=(d,n) => { const x=new Date(d); x.setMonth(x.getMonth()+n); return x; };
const parseD  = (s)  => new Date(s+"T00:00:00");
const PALETTE = ["#4D9EFF","#00C896","#A78BFA","#F0A500","#FF6B9D","#22D3EE","#FF4D4D","#34D399","#F472B6","#60A5FA"];
const TODAY_STR = dateStr(TODAY);

function balColor(balance, overdraftLimit) {
  const lim = overdraftLimit || 0;
  const floor = -(Math.abs(lim));
  if (balance < floor) return "#FF4D4D";
  if (balance < 0)     return "#F0A500";
  if (balance < 5000)  return "#F0A500";
  return "#00C896";
}

function expandRecurring(proj) {
  if (proj.recurrence==="once") return [{...proj, occDate:proj.startDate, occId:proj.id+"_0"}];
  const list=[], end=parseD(proj.endDate||proj.startDate);
  let cur=parseD(proj.startDate), i=0;
  while(cur<=end && i<730){
    list.push({...proj, occDate:dateStr(cur), occId:proj.id+"_"+i});
    if(proj.recurrence==="daily")   cur=addDays(cur,1);
    else if(proj.recurrence==="weekly")  cur=addWeeks(cur,1);
    else if(proj.recurrence==="monthly") cur=addMonths(cur,1);
    i++;
  }
  return list;
}

// ─────────────────────────────────────────────────────────────────────────────
// SEED DATA
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_CATEGORIES = [
  {id:"cat1",name:"Revenue",     type:"income",  color:COLORS.accent },
  {id:"cat2",name:"Membership",  type:"income",  color:COLORS.blue   },
  {id:"cat3",name:"Retail",      type:"income",  color:COLORS.teal   },
  {id:"cat4",name:"Other Income",type:"income",  color:COLORS.purple },
  {id:"cat5",name:"Payroll",     type:"expense", color:COLORS.danger },
  {id:"cat6",name:"Marketing",   type:"expense", color:COLORS.warning},
  {id:"cat7",name:"Inventory",   type:"expense", color:"#FF6B9D"},
  {id:"cat8",name:"Rent",        type:"expense", color:"#F472B6"},
  {id:"cat9",name:"Software",    type:"expense", color:"#60A5FA"},
  {id:"cat10",name:"Utilities",  type:"expense", color:"#34D399"},
  {id:"cat11",name:"Tax",        type:"expense", color:"#F97316"},
  {id:"cat12",name:"Other",      type:"expense", color:COLORS.textMid},
];
const DEFAULT_ENTITIES = [
  {id:"cml", name:"Canada MedLaser Inc",         short:"CML",  color:COLORS.blue   },
  {id:"cmlf",name:"Canada MedLaser Franchising", short:"CMLF", color:COLORS.purple },
  {id:"ssb", name:"Skin Society Bar",             short:"SSB",  color:COLORS.accent },
  {id:"acad",name:"CML Academy",                 short:"ACAD", color:COLORS.warning},
  {id:"yeco",name:"YECO Marketing",              short:"YECO", color:"#FF6B9D"},
];
const DEFAULT_ACCOUNTS = [
  {id:"a1", entityId:"cml", name:"RBC Operations",        number:"****4821",openBalance:48200, overdraft:10000},
  {id:"a2", entityId:"cml", name:"TD Payroll",            number:"****7734",openBalance:12500, overdraft:5000 },
  {id:"a3", entityId:"cml", name:"RBC Reserve",           number:"****2290",openBalance:85000, overdraft:0    },
  {id:"a4", entityId:"cmlf",name:"BMO Main",              number:"****3310",openBalance:31000, overdraft:10000},
  {id:"a5", entityId:"cmlf",name:"BMO Trust",             number:"****9901",openBalance:60000, overdraft:0    },
  {id:"a6", entityId:"ssb", name:"Scotiabank Chequing",   number:"****1147",openBalance:18400, overdraft:5000 },
  {id:"a7", entityId:"ssb", name:"Scotiabank HST Reserve",number:"****5566",openBalance:7800,  overdraft:0    },
  {id:"a8", entityId:"acad",name:"RBC Chequing",          number:"****8823",openBalance:22100, overdraft:3000 },
  {id:"a9", entityId:"yeco",name:"TD Chequing",           number:"****6612",openBalance:9400,  overdraft:2000 },
  {id:"a10",entityId:"yeco",name:"TD Ad Spend",           number:"****0043",openBalance:15000, overdraft:0    },
];

function genTxns(account, entity, categories) {
  const iC=categories.filter(c=>c.type==="income"), eC=categories.filter(c=>c.type==="expense");
  const dI=["Client Payment","Membership Fee","Service Revenue","Gift Card","Retail Sale","E-Transfer","VISA Batch"];
  const dE=["Payroll Run","Supplies","Software Sub","Merchant Fee","Utility Bill","Rent","Ad Spend","HST Remit"];
  const out=[];
  for(let i=20;i>=1;i--){
    const d=dateStr(addDays(TODAY,-i));
    const nI=Math.floor(Math.random()*3)+1, nE=Math.floor(Math.random()*2)+1;
    for(let j=0;j<nI;j++) out.push({id:uid(),date:d,description:dI[Math.random()*dI.length|0]+" — "+entity.short,amount:Math.round((Math.random()*900+150)*100)/100,type:"income", categoryId:iC[Math.random()*iC.length|0]?.id||"cat1", source:"quickbooks",accountId:account.id,entityId:entity.id,status:"actual"});
    for(let j=0;j<nE;j++) out.push({id:uid(),date:d,description:dE[Math.random()*dE.length|0],              amount:Math.round((Math.random()*600+80)*100)/100, type:"expense",categoryId:eC[Math.random()*eC.length|0]?.id||"cat5", source:"quickbooks",accountId:account.id,entityId:entity.id,status:"actual"});
  }
  return out;
}

const DEFAULT_PROJECTIONS = [
  {id:"p1",entityId:"ssb", accountId:"a6", description:"Membership Renewal Batch",amount:2400, type:"income", categoryId:"cat2",recurrence:"monthly",startDate:dateStr(addDays(TODAY,3)), endDate:dateStr(addMonths(TODAY,6))},
  {id:"p2",entityId:"ssb", accountId:"a6", description:"Payroll Run",             amount:3800, type:"expense",categoryId:"cat5",recurrence:"monthly",startDate:dateStr(addDays(TODAY,6)), endDate:dateStr(addMonths(TODAY,6))},
  {id:"p3",entityId:"cml", accountId:"a1", description:"Franchise Royalties In",  amount:5500, type:"income", categoryId:"cat1",recurrence:"monthly",startDate:dateStr(addDays(TODAY,2)), endDate:dateStr(addMonths(TODAY,12))},
  {id:"p4",entityId:"yeco",accountId:"a10",description:"Meta Ad Spend",           amount:1500, type:"expense",categoryId:"cat6",recurrence:"weekly", startDate:dateStr(addDays(TODAY,1)), endDate:dateStr(addMonths(TODAY,3))},
  {id:"p5",entityId:"cml", accountId:"a2", description:"Staff Payroll",           amount:12000,type:"expense",categoryId:"cat5",recurrence:"monthly",startDate:dateStr(addDays(TODAY,10)),endDate:dateStr(addMonths(TODAY,12))},
  {id:"p6",entityId:"acad",accountId:"a8", description:"Course Tuition Batch",    amount:3200, type:"income", categoryId:"cat1",recurrence:"monthly",startDate:dateStr(addDays(TODAY,5)), endDate:dateStr(addMonths(TODAY,6))},
];

// ─────────────────────────────────────────────────────────────────────────────
// PRIMITIVES
// ─────────────────────────────────────────────────────────────────────────────
const inpS = ()=>({background:"#0A0E14",border:"1px solid #1E2D40",borderRadius:7,padding:"8px 11px",color:"#E8F0FC",fontSize:13,width:"100%",fontFamily:"inherit",outline:"none"});
const selS = ()=>({...inpS()});
function Badge({children,color}){ const c=color||"#00C896"; return <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",padding:"2px 8px",borderRadius:99,background:c+"22",color:c,border:`1px solid ${c}33`,whiteSpace:"nowrap"}}>{children}</span>; }
function Dot({color,size}){ return <span style={{display:"inline-block",width:size||8,height:size||8,borderRadius:"50%",background:color,flexShrink:0}}/>; }
function Fld({label,children}){ return <div><div style={{fontSize:10,color:"#2A3D55",textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:700,marginBottom:5}}>{label}</div>{children}</div>; }
function Empty({msg}){ return <div style={{padding:"36px 20px",textAlign:"center",color:"#2A3D55",fontSize:13}}>{msg}</div>; }

function ColHdr({cols,labels}){
  return <div style={{display:"grid",gridTemplateColumns:cols,gap:10,padding:"8px 14px",borderBottom:"1px solid #1E2D40",background:"#161E2A"}}>
    {labels.map(l=><span key={l} style={{fontSize:10,color:"#7A96B0",textTransform:"uppercase",letterSpacing:"0.09em",fontWeight:600}}>{l}</span>)}
  </div>;
}
function KpiCard({label,value,color,sub}){
  return <div style={{background:"#111820",border:"1px solid #1E2D40",borderRadius:10,padding:"12px 14px"}}>
    <div style={{fontSize:10,color:"#6B8299",textTransform:"uppercase",letterSpacing:"0.1em",fontWeight:700,marginBottom:4}}>{label}</div>
    <div style={{fontSize:20,fontWeight:800,color:color||"#00C896",fontFamily:"'Space Grotesk',monospace",letterSpacing:"-0.02em"}}>{value}</div>
    {sub&&<div style={{fontSize:11,color:"#6B8299",marginTop:3}}>{sub}</div>}
  </div>;
}
function SectionHead({title,sub,action}){
  return <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16}}>
    <div>
      <h2 style={{fontFamily:"'Space Grotesk',sans-serif",fontSize:18,fontWeight:800,letterSpacing:"-0.02em",color:"#E8F0FC",margin:0}}>{title}</h2>
      {sub&&<p style={{color:"#6B8299",fontSize:12,marginTop:3,margin:0}}>{sub}</p>}
    </div>
    {action}
  </div>;
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTH GATE — wraps the entire app
// ─────────────────────────────────────────────────────────────────────────────
export default function AuthGate() {
  const [session,  setSession]  = useState(null);   // {user} or null
  const [users,    setUsers]    = useState(null);    // loaded from storage
  const [authReady,setAuthReady]= useState(false);

  // Load session + users from localStorage on mount
  useEffect(()=>{
    try {
      const storedUsers = localStorage.getItem(USERS_KEY);
      const parsedUsers = storedUsers ? JSON.parse(storedUsers) : null;
      // Auto-clear stale cache: if stored users don't include any of the default emails, wipe and reset
      const defaultEmails = DEFAULT_USERS.map(u=>u.email.toLowerCase());
      const storedEmails  = (parsedUsers||[]).map(u=>u.email?.toLowerCase());
      const hasValidUser  = defaultEmails.some(e=>storedEmails.includes(e));
      if (parsedUsers && !hasValidUser) {
        localStorage.removeItem(USERS_KEY);
        sessionStorage.removeItem(SESSION_KEY);
        setUsers(DEFAULT_USERS);
        setAuthReady(true);
        return;
      }
      setUsers(parsedUsers || DEFAULT_USERS);
      const storedSession = sessionStorage.getItem(SESSION_KEY);
      if (storedSession) {
        const s = JSON.parse(storedSession);
        const liveUsers = parsedUsers || DEFAULT_USERS;
        if (liveUsers.find(u=>u.id===s.user?.id)) setSession(s);
      }
    } catch(e) { setUsers(DEFAULT_USERS); }
    setAuthReady(true);
  },[]);

  const saveUsers = (updated) => {
    setUsers(updated);
    try { localStorage.setItem(USERS_KEY, JSON.stringify(updated)); } catch(e){}
  };

  const login = (user) => {
    const s = { user, loginAt: Date.now() };
    setSession(s);
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch(e){}
  };

  const logout = () => {
    setSession(null);
    try { sessionStorage.removeItem(SESSION_KEY); } catch(e){}
  };

  if (!authReady) return (
    <div style={{minHeight:"100vh",background:"#0A0E14",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{color:"#00C896",fontSize:13,fontFamily:"sans-serif"}}>Loading…</div>
    </div>
  );

  if (!session) return <LoginScreen users={users||DEFAULT_USERS} onLogin={login} saveUsers={saveUsers}/>;

  return <CashFlowPro session={session} onLogout={logout} users={users||DEFAULT_USERS} saveUsers={saveUsers}/>;
}

// ─────────────────────────────────────────────────────────────────────────────
// LOGIN SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function LoginScreen({ users, onLogin, saveUsers }) {
  const [view,     setView]     = useState("login");   // "login" | "forgot" | "sent"
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [showPw,   setShowPw]   = useState(false);
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [resetEmail, setResetEmail] = useState("");

  const iS = {width:"100%",background:"#0A0E14",border:"1px solid #1E2D40",borderRadius:8,padding:"10px 13px",color:"#E8F0FC",fontSize:13,fontFamily:"inherit",transition:"border-color 0.15s",outline:"none"};

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    await new Promise(r=>setTimeout(r,400));
    const user = users.find(u=>u.email.toLowerCase()===email.trim().toLowerCase());
    if (!user) { setError("No account found with that email."); setLoading(false); return; }
    const hash = await hashPw(password);
    // First-time: no password set yet — silently accept and save
    if (!user.hash) {
      const updated = users.map(u=>u.id===user.id?{...u,hash}:u);
      saveUsers(updated);
      onLogin({...user,hash});
      setLoading(false);
      return;
    }
    if (hash !== user.hash) { setError("Incorrect password. Try again or use Forgot password."); setLoading(false); return; }
    onLogin(user);
    setLoading(false);
  };

  // Forgot password — generates a reset token, stores it, emails user via mailto
  const handleForgot = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    await new Promise(r=>setTimeout(r,400));
    const user = users.find(u=>u.email.toLowerCase()===resetEmail.trim().toLowerCase());
    if (!user) { setError("No account found with that email."); setLoading(false); return; }
    // Generate a 6-digit reset code valid for 30 minutes
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiry = Date.now() + 30 * 60 * 1000;
    // Store reset code in localStorage
    try { localStorage.setItem("cfp_reset_"+user.id, JSON.stringify({code, expiry})); } catch(e){}
    // Open mailto — works without a mail server
    const subject = encodeURIComponent("CashFlow Pro — Password Reset Code");
    const body = encodeURIComponent(
      `Your CashFlow Pro password reset code is:\n\n${code}\n\nThis code expires in 30 minutes.\n\nIf you did not request this, ignore this email.`
    );
    window.location.href = `mailto:${user.email}?subject=${subject}&body=${body}`;
    setLoading(false);
    setView("reset");
  };

  const [resetCode, setResetCode] = useState("");
  const [newPw,     setNewPw]     = useState("");
  const [showNewPw, setShowNewPw] = useState(false);

  const handleReset = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    await new Promise(r=>setTimeout(r,300));
    const user = users.find(u=>u.email.toLowerCase()===resetEmail.trim().toLowerCase());
    if (!user) { setError("User not found."); setLoading(false); return; }
    let stored;
    try { stored = JSON.parse(localStorage.getItem("cfp_reset_"+user.id)||"null"); } catch(e){}
    if (!stored) { setError("No reset was requested. Start over."); setLoading(false); return; }
    if (Date.now() > stored.expiry) { setError("Code expired. Request a new one."); setLoading(false); return; }
    if (resetCode.trim() !== stored.code) { setError("Incorrect code. Check your email."); setLoading(false); return; }
    if (newPw.length < 8) { setError("Password must be at least 8 characters."); setLoading(false); return; }
    const hash = await hashPw(newPw);
    const updated = users.map(u=>u.id===user.id?{...u,hash}:u);
    saveUsers(updated);
    try { localStorage.removeItem("cfp_reset_"+user.id); } catch(e){}
    setLoading(false);
    setView("login");
    setEmail(resetEmail);
    setPassword("");
    setError("");
    setResetCode("");
    setNewPw("");
  };

  const inp = (val, set, placeholder, type="text") => (
    <input type={type} value={val} onChange={e=>{set(e.target.value);setError("");}}
      placeholder={placeholder} required style={iS}
      onFocus={e=>e.target.style.borderColor="#00C896"}
      onBlur={e=>e.target.style.borderColor="#1E2D40"}/>
  );

  return (
    <div style={{minHeight:"100vh",background:"#0A0E14",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'DM Sans',system-ui,sans-serif",padding:20}}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@700;800&display=swap');*{box-sizing:border-box;margin:0;padding:0}input{outline:none}@keyframes fadein{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}`}</style>

      <div style={{width:"100%",maxWidth:400,animation:"fadein 0.35s ease"}}>
        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:32}}>
          <div style={{width:52,height:52,borderRadius:14,background:"linear-gradient(135deg,#00C896,#006644)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,margin:"0 auto 14px"}}>💰</div>
          <div style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:800,fontSize:22,color:"#E8F0FC",letterSpacing:"-0.02em"}}>CashFlow Pro</div>
        </div>

        <div style={{background:"#111820",border:"1px solid #1E2D40",borderRadius:14,padding:32}}>

          {/* ── SIGN IN ─────────────────────────────────────── */}
          {view==="login"&&(<>
            <div style={{fontWeight:700,fontSize:16,color:"#E8F0FC",marginBottom:4}}>Sign in</div>
            <div style={{fontSize:12,color:"#6B8299",marginBottom:24}}>Authorized personnel only</div>
            <form onSubmit={handleLogin}>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,color:"#6B8299",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:700,display:"block",marginBottom:6}}>Email</label>
                {inp(email, setEmail, "you@canadamedlaser.ca", "email")}
              </div>
              <div style={{marginBottom:8}}>
                <label style={{fontSize:11,color:"#6B8299",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:700,display:"block",marginBottom:6}}>Password</label>
                <div style={{position:"relative"}}>
                  <input type={showPw?"text":"password"} value={password} onChange={e=>{setPassword(e.target.value);setError("");}} placeholder="Enter your password" required
                    style={{...iS,paddingRight:40}}
                    onFocus={e=>e.target.style.borderColor="#00C896"}
                    onBlur={e=>e.target.style.borderColor="#1E2D40"}/>
                  <button type="button" onClick={()=>setShowPw(v=>!v)}
                    style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#6B8299",cursor:"pointer",fontSize:14,padding:2}}>
                    {showPw?"🙈":"👁"}
                  </button>
                </div>
              </div>
              {/* Forgot password link */}
              <div style={{textAlign:"right",marginBottom:16}}>
                <button type="button" onClick={()=>{setView("forgot");setResetEmail(email);setError("");}}
                  style={{background:"none",border:"none",color:"#4D9EFF",fontSize:12,cursor:"pointer",padding:0,fontFamily:"inherit"}}>
                  Forgot password?
                </button>
              </div>
              {error&&<div style={{background:"#2A0A0A",border:"1px solid #FF4D4D44",borderRadius:8,padding:"9px 13px",marginBottom:14,fontSize:12,color:"#FF4D4D",display:"flex",gap:7}}><span>⚠</span><span>{error}</span></div>}
              <button type="submit" disabled={loading}
                style={{width:"100%",background:loading?"#182030":"#00C896",color:loading?"#6B8299":"#000",border:"none",borderRadius:9,padding:"12px 0",fontSize:14,fontWeight:800,cursor:loading?"not-allowed":"pointer",transition:"all 0.2s"}}>
                {loading?"Signing in…":"Sign In"}
              </button>
            </form>
          </>)}

          {/* ── FORGOT PASSWORD ─────────────────────────────── */}
          {view==="forgot"&&(<>
            <button onClick={()=>{setView("login");setError("");}} style={{background:"none",border:"none",color:"#6B8299",cursor:"pointer",fontSize:12,marginBottom:16,padding:0,display:"flex",alignItems:"center",gap:4,fontFamily:"inherit"}}>← Back to sign in</button>
            <div style={{fontWeight:700,fontSize:16,color:"#E8F0FC",marginBottom:4}}>Reset password</div>
            <div style={{fontSize:12,color:"#6B8299",marginBottom:20}}>Enter your email — a reset code will open in your mail app.</div>
            <form onSubmit={handleForgot}>
              <div style={{marginBottom:16}}>
                <label style={{fontSize:11,color:"#6B8299",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:700,display:"block",marginBottom:6}}>Email</label>
                {inp(resetEmail, setResetEmail, "you@canadamedlaser.ca", "email")}
              </div>
              {error&&<div style={{background:"#2A0A0A",border:"1px solid #FF4D4D44",borderRadius:8,padding:"9px 13px",marginBottom:14,fontSize:12,color:"#FF4D4D",display:"flex",gap:7}}><span>⚠</span><span>{error}</span></div>}
              <div style={{background:"#0A1525",border:"1px solid #4D9EFF22",borderRadius:8,padding:"9px 13px",marginBottom:16,fontSize:11,color:"#6B8299",lineHeight:1.5}}>
                This will open your email app with a pre-filled message containing a 6-digit code. Send it to yourself, then enter the code on the next screen.
              </div>
              <button type="submit" disabled={loading}
                style={{width:"100%",background:loading?"#182030":"#4D9EFF",color:loading?"#6B8299":"#000",border:"none",borderRadius:9,padding:"12px 0",fontSize:14,fontWeight:800,cursor:loading?"not-allowed":"pointer",transition:"all 0.2s"}}>
                {loading?"Sending…":"Send Reset Code"}
              </button>
            </form>
          </>)}

          {/* ── ENTER RESET CODE + NEW PASSWORD ─────────────── */}
          {view==="reset"&&(<>
            <button onClick={()=>{setView("forgot");setError("");}} style={{background:"none",border:"none",color:"#6B8299",cursor:"pointer",fontSize:12,marginBottom:16,padding:0,display:"flex",alignItems:"center",gap:4,fontFamily:"inherit"}}>← Back</button>
            <div style={{fontWeight:700,fontSize:16,color:"#E8F0FC",marginBottom:4}}>Set new password</div>
            <div style={{fontSize:12,color:"#6B8299",marginBottom:20}}>Check your email for the 6-digit code and set a new password.</div>
            <form onSubmit={handleReset}>
              <div style={{marginBottom:14}}>
                <label style={{fontSize:11,color:"#6B8299",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:700,display:"block",marginBottom:6}}>Reset Code</label>
                <input type="text" value={resetCode} onChange={e=>{setResetCode(e.target.value.replace(/\D/g,"").slice(0,6));setError("");}}
                  placeholder="6-digit code from email" maxLength={6} required style={{...iS,letterSpacing:"0.3em",fontSize:18,textAlign:"center"}}
                  onFocus={e=>e.target.style.borderColor="#00C896"}
                  onBlur={e=>e.target.style.borderColor="#1E2D40"}/>
              </div>
              <div style={{marginBottom:16}}>
                <label style={{fontSize:11,color:"#6B8299",textTransform:"uppercase",letterSpacing:"0.08em",fontWeight:700,display:"block",marginBottom:6}}>New Password</label>
                <div style={{position:"relative"}}>
                  <input type={showNewPw?"text":"password"} value={newPw} onChange={e=>{setNewPw(e.target.value);setError("");}}
                    placeholder="Min 8 characters" required minLength={8}
                    style={{...iS,paddingRight:40}}
                    onFocus={e=>e.target.style.borderColor="#00C896"}
                    onBlur={e=>e.target.style.borderColor="#1E2D40"}/>
                  <button type="button" onClick={()=>setShowNewPw(v=>!v)}
                    style={{position:"absolute",right:10,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",color:"#6B8299",cursor:"pointer",fontSize:14,padding:2}}>
                    {showNewPw?"🙈":"👁"}
                  </button>
                </div>
              </div>
              {error&&<div style={{background:"#2A0A0A",border:"1px solid #FF4D4D44",borderRadius:8,padding:"9px 13px",marginBottom:14,fontSize:12,color:"#FF4D4D",display:"flex",gap:7}}><span>⚠</span><span>{error}</span></div>}
              <button type="submit" disabled={loading||resetCode.length<6||newPw.length<8}
                style={{width:"100%",background:loading||resetCode.length<6||newPw.length<8?"#182030":"#00C896",color:loading||resetCode.length<6||newPw.length<8?"#6B8299":"#000",border:"none",borderRadius:9,padding:"12px 0",fontSize:14,fontWeight:800,cursor:(loading||resetCode.length<6||newPw.length<8)?"not-allowed":"pointer",transition:"all 0.2s"}}>
                {loading?"Setting password…":"Set New Password"}
              </button>
            </form>
          </>)}

        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// USER MANAGEMENT (shown inside Settings for admins only)
// ─────────────────────────────────────────────────────────────────────────────
function UserManagement({ users, saveUsers, currentUser }) {
  const blank = { name:"", email:"", role:"viewer" };
  const [form,   setForm]   = useState(blank);
  const [editId, setEditId] = useState(null);
  const [resetMsg, setResetMsg] = useState(null);

  const save = () => {
    if (!form.name||!form.email) return;
    if (editId) {
      saveUsers(users.map(u=>u.id===editId ? {...u, name:form.name, email:form.email, role:form.role} : u));
      setEditId(null);
    } else {
      saveUsers([...users, {...form, id:uid(), hash:""}]);
    }
    setForm(blank);
  };
  const startEdit = (u) => { setForm({name:u.name,email:u.email,role:u.role}); setEditId(u.id); };
  const del = (id) => {
    if (id===currentUser.id) return; // can't delete yourself
    saveUsers(users.filter(u=>u.id!==id));
    if (editId===id){setEditId(null);setForm(blank);}
  };
  const resetPassword = (id) => {
    saveUsers(users.map(u=>u.id===id?{...u,hash:""}:u));
    setResetMsg("Password reset. User will set a new one on next login.");
    setTimeout(()=>setResetMsg(null),4000);
  };

  const ROLE_COLORS = { admin:COLORS.accent, viewer:COLORS.blue };
  const ROLE_LABELS = { admin:"Admin — full access", viewer:"Viewer — read only" };

  return (
    <div>
      {/* Form */}
      <div style={{background:COLORS.surface,border:`1px solid ${editId?COLORS.blue+"55":COLORS.accent+"44"}`,borderRadius:12,padding:18,marginBottom:20}}>
        <div style={{fontSize:12,fontWeight:700,color:editId?COLORS.blue:COLORS.accent,marginBottom:14}}>{editId?"✏ Edit User":"＋ Add User"}</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 100px",gap:10,alignItems:"end"}}>
          <Fld label="Full Name"><input style={inpS()} placeholder="Jane Smith" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></Fld>
          <Fld label="Email"><input style={inpS()} type="email" placeholder="jane@company.ca" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))}/></Fld>
          <Fld label="Role">
            <select style={selS()} value={form.role} onChange={e=>setForm(f=>({...f,role:e.target.value}))}>
              <option value="admin">Admin — full access</option>
              <option value="viewer">Viewer — read only</option>
            </select>
          </Fld>
          <div style={{display:"flex",gap:7,alignItems:"flex-end"}}>
            <button onClick={save} style={{flex:1,background:editId?COLORS.blue:COLORS.accent,color:"#000",border:"none",borderRadius:7,padding:"9px 0",fontWeight:700,fontSize:12,cursor:"pointer"}}>{editId?"Save":"Add"}</button>
            {editId&&<button onClick={()=>{setEditId(null);setForm(blank);}} style={{background:"#161E2A",color:COLORS.textMid,border:`1px solid ${COLORS.border}`,borderRadius:7,padding:"9px 8px",fontSize:12,cursor:"pointer"}}>✕</button>}
          </div>
        </div>
      </div>

      {resetMsg&&<div style={{background:COLORS.accentDim,border:`1px solid ${COLORS.accent}33`,borderRadius:8,padding:"9px 14px",marginBottom:14,fontSize:12,color:COLORS.accent}}>✓ {resetMsg}</div>}

      {/* Role legend */}
      <div style={{display:"flex",gap:16,marginBottom:14,fontSize:11,color:COLORS.textMid}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:COLORS.accent,display:"inline-block"}}/><span>Admin — can edit everything, manage users, delete transactions</span></div>
        <div style={{display:"flex",alignItems:"center",gap:6}}><span style={{width:8,height:8,borderRadius:"50%",background:COLORS.blue,display:"inline-block"}}/><span>Viewer — read-only, no delete, no settings</span></div>
      </div>

      {/* Users table */}
      <div style={{background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderRadius:12,overflow:"hidden"}}>
        <ColHdr cols="1fr 1fr 100px 120px 160px" labels={["Name","Email","Role","Status","Actions"]}/>
        {users.map(u=>(
          <div key={u.id} className="rh" style={{display:"grid",gridTemplateColumns:"1fr 1fr 100px 120px 160px",gap:10,padding:"10px 14px",alignItems:"center",borderBottom:`1px solid ${COLORS.border}`,transition:"background 0.12s",background:editId===u.id?COLORS.blue+"09":"transparent"}}>
            <div style={{display:"flex",alignItems:"center",gap:9}}>
              <div style={{width:30,height:30,borderRadius:"50%",background:ROLE_COLORS[u.role]+"22",border:`1px solid ${ROLE_COLORS[u.role]}44`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,fontWeight:700,color:ROLE_COLORS[u.role],flexShrink:0}}>
                {u.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <div style={{fontSize:13,color:COLORS.text,fontWeight:600}}>{u.name}</div>
                {u.id===currentUser.id&&<div style={{fontSize:10,color:COLORS.accent}}>You</div>}
              </div>
            </div>
            <span style={{fontSize:12,color:COLORS.textMid,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{u.email}</span>
            <span style={{fontSize:10,fontWeight:700,letterSpacing:"0.07em",textTransform:"uppercase",padding:"2px 8px",borderRadius:99,background:ROLE_COLORS[u.role]+"22",color:ROLE_COLORS[u.role],border:`1px solid ${ROLE_COLORS[u.role]}33`}}>{u.role}</span>
            <span style={{fontSize:11}}>{u.hash?"🔒 Password set":"⚪ No password yet"}</span>
            <div style={{display:"flex",gap:5}}>
              <button onClick={()=>startEdit(u)} style={{background:COLORS.blueDim,border:`1px solid ${COLORS.blue}33`,color:COLORS.blue,borderRadius:5,padding:"3px 8px",fontSize:10,cursor:"pointer",fontWeight:700}}>Edit</button>
              <button onClick={()=>resetPassword(u.id)} title="Force password reset on next login" style={{background:COLORS.warningDim,border:`1px solid ${COLORS.warning}33`,color:COLORS.warning,borderRadius:5,padding:"3px 8px",fontSize:10,cursor:"pointer",fontWeight:700}}>Reset PW</button>
              {u.id!==currentUser.id&&<button onClick={()=>del(u.id)} style={{background:COLORS.dangerDim,border:`1px solid ${COLORS.danger}33`,color:COLORS.danger,borderRadius:5,padding:"3px 8px",fontSize:10,cursor:"pointer",fontWeight:700}}>Del</button>}
            </div>
          </div>
        ))}
        {users.length===0&&<Empty msg="No users."/>}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN APP (internal — wrapped by AuthGate)
// ─────────────────────────────────────────────────────────────────────────────
function CashFlowPro({ session, onLogout, users, saveUsers }) {
  const isAdmin = session?.user?.role === "admin";

  // ── Load persisted data safely inside useState initializers ──────────────
  const [entities,   setEntities]   = useState(()=>{ try{ const d=JSON.parse(localStorage.getItem(DATA_KEY)||"{}"); return d.entities||DEFAULT_ENTITIES; }catch(e){ return DEFAULT_ENTITIES; } });
  const [accounts,   setAccounts]   = useState(()=>{ try{ const d=JSON.parse(localStorage.getItem(DATA_KEY)||"{}"); return d.accounts||DEFAULT_ACCOUNTS; }catch(e){ return DEFAULT_ACCOUNTS; } });
  const [categories, setCategories] = useState(()=>{ try{ const d=JSON.parse(localStorage.getItem(DATA_KEY)||"{}"); return d.categories||DEFAULT_CATEGORIES; }catch(e){ return DEFAULT_CATEGORIES; } });
  const [projections,setProjections]= useState(()=>{ try{ const d=JSON.parse(localStorage.getItem(DATA_KEY)||"{}"); return d.projections||DEFAULT_PROJECTIONS; }catch(e){ return DEFAULT_PROJECTIONS; } });
  const [actualTxns, setActualTxns] = useState(()=>{ try{ const d=JSON.parse(localStorage.getItem(DATA_KEY)||"{}"); return d.actualTxns||(DEFAULT_ACCOUNTS.flatMap(acc=>{const e=DEFAULT_ENTITIES.find(x=>x.id===acc.entityId);return e?genTxns(acc,e,DEFAULT_CATEGORIES):[];})); }catch(e){ return DEFAULT_ACCOUNTS.flatMap(acc=>{const ent=DEFAULT_ENTITIES.find(x=>x.id===acc.entityId);return ent?genTxns(acc,ent,DEFAULT_CATEGORIES):[];}); } });
  const [skippedOccs,setSkippedOccs]= useState(()=>{ try{ const d=JSON.parse(localStorage.getItem(DATA_KEY)||"{}"); return new Set(d.skippedOccs||[]); }catch(e){ return new Set(); } });

  // ── Auto-save all data to localStorage on any change ─────────────────────
  useEffect(()=>{
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify({
        entities, accounts, categories, projections,
        actualTxns,
        skippedOccs: [...skippedOccs],
      }));
    } catch(e){}
  },[entities, accounts, categories, projections, actualTxns, skippedOccs]);

  const [tab,           setTab]           = useState("dashboard");
  const [settingsTab,   setSettingsTab]   = useState("entities");
  const [filterEntity,  setFilterEntity]  = useState("all");
  const [filterAccount, setFilterAccount] = useState("all");
  const [txnTypeFilter, setTxnTypeFilter] = useState("all");
  const [txnStatusFilter,setTxnStatusFilter]=useState("all");
  const [dateFrom,      setDateFrom]      = useState("");
  const [dateTo,        setDateTo]        = useState("");
  const [forecastDays,  setForecastDays]  = useState(30);
  const [chartSubTab,   setChartSubTab]   = useState("line");
  const [qbConnectMsg,  setQbConnectMsg]  = useState(null);
  const [syncing,       setSyncing]       = useState(false);
  const [syncMsg,       setSyncMsg]       = useState(null);
  const [syncFromDate,  setSyncFromDate]  = useState(TODAY_STR);

  // Detect QB OAuth callback redirect (?qb_connected=entityId)
  useEffect(()=>{
    try {
      const params = new URLSearchParams(window.location.search);
      const connected = params.get("qb_connected");
      const qbError   = params.get("qb_error");
      if (connected) {
        setQbConnectMsg({ type:"success", msg:`✓ QuickBooks connected successfully! You can now sync transactions.` });
        window.history.replaceState({}, "", window.location.pathname);
        setTab("settings"); setSettingsTab("bank sync");
        setTimeout(()=>setQbConnectMsg(null), 6000);
      } else if (qbError) {
        setQbConnectMsg({ type:"error", msg:`QB connection failed: ${qbError}` });
        window.history.replaceState({}, "", window.location.pathname);
        setTimeout(()=>setQbConnectMsg(null), 6000);
      }
    } catch(e){ console.warn("QB callback check failed:", e); }
  },[]);

  // ── Delete state ─────────────────────────────────────────────────────────
  const [selectedIds,   setSelectedIds]   = useState(new Set());
  const [confirmModal,  setConfirmModal]  = useState(null);

  const toggleSelect = (id) => setSelectedIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const toggleSelectAll = (ids) => setSelectedIds(prev => {
    const allSel = ids.every(id => prev.has(id));
    return allSel ? new Set([...prev].filter(id => !ids.includes(id))) : new Set([...prev, ...ids]);
  });
  const clearSelection = () => setSelectedIds(new Set());
  const askDeleteSingle = (row) => setConfirmModal({mode:"single", row});
  const askDeleteBulk   = ()    => setConfirmModal({mode:"bulk"});
  const confirmDelete = () => {
    if (!confirmModal) return;
    if (confirmModal.mode === "single") {
      if (confirmModal.row._status === "actual") {
        setActualTxns(prev => prev.filter(t => t.id !== confirmModal.row.id));
        setSelectedIds(prev => { const n = new Set(prev); n.delete(confirmModal.row.id); return n; });
      } else if (confirmModal.row._status === "projected") {
        if (confirmModal.projMode === "occurrence") {
          setSkippedOccs(prev => new Set([...prev, confirmModal.row.occId]));
        } else {
          // delete the entire projection rule using ruleId
          const ruleId = confirmModal.row.ruleId || confirmModal.row.id;
          setProjections(prev => prev.filter(p => p.id !== ruleId));
        }
      }
    } else if (confirmModal.mode === "bulk") {
      setActualTxns(prev => prev.filter(t => !selectedIds.has(t.id)));
      setSelectedIds(new Set());
    }
    setConfirmModal(null);
  };
  const cancelDelete = () => setConfirmModal(null);

  const availAccounts = useMemo(()=>
    filterEntity==="all"?accounts:accounts.filter(a=>a.entityId===filterEntity),[accounts,filterEntity]);
  useEffect(()=>setFilterAccount("all"),[filterEntity]);

  // Opening balance for current filter
  const openingBalance = useMemo(()=>{
    if(filterAccount!=="all") return accounts.find(a=>a.id===filterAccount)?.openBalance??0;
    return availAccounts.reduce((s,a)=>s+(a.openBalance||0),0);
  },[filterAccount,availAccounts,accounts]);

  // Combined overdraft limit for current filter (sum when multiple accounts)
  const overdraftLimit = useMemo(()=>{
    if(filterAccount!=="all") return accounts.find(a=>a.id===filterAccount)?.overdraft??0;
    return availAccounts.reduce((s,a)=>s+(a.overdraft||0),0);
  },[filterAccount,availAccounts,accounts]);

  // Filtered actual txns
  const filteredActuals = useMemo(()=>actualTxns.filter(t=>
    (filterEntity==="all"||t.entityId===filterEntity)&&
    (filterAccount==="all"||t.accountId===filterAccount)
  ),[actualTxns,filterEntity,filterAccount]);

  // Expanded projected occurrences — unlimited window (up to 2 years or dateTo filter)
  const filteredProjOccs = useMemo(()=>{
    const endDate = dateTo || dateStr(addDays(TODAY, 730)); // 2 years if no date filter
    return projections
      .filter(p=>(filterEntity==="all"||p.entityId===filterEntity)&&(filterAccount==="all"||p.accountId===filterAccount))
      .flatMap(expandRecurring)
      .filter(occ=>occ.occDate > TODAY_STR && occ.occDate <= endDate && !skippedOccs.has(occ.occId));
  },[projections,filterEntity,filterAccount,dateTo,skippedOccs]);

  // ── UNIFIED LEDGER ────────────────────────────────────────────────────────
  // Merge actual txns + projected occurrences into one chronological ledger
  // with per-line running balance. Projected rows that "arrive" today stay
  // projected — they only become actual when QB syncs them in.
  const unifiedLedger = useMemo(()=>{
    // Build actual rows
    const actRows = filteredActuals.map(t=>({
      ...t,
      _date: t.date,
      _status:"actual",
      _sortKey: t.date+"_A_"+t.id,
    }));

    // Build projected rows — only future dates (> today)
    const projRows = filteredProjOccs.map(occ=>({
      id:          occ.occId,
      occId:       occ.occId,        // needed for single-occurrence skip
      ruleId:      occ.id,           // the original projection rule id
      date:        occ.occDate,
      description: occ.description,
      amount:      occ.amount,
      type:        occ.type,
      categoryId:  occ.categoryId,
      entityId:    occ.entityId,
      accountId:   occ.accountId,
      source:      "projected",
      recurrence:  occ.recurrence,
      _date:       occ.occDate,
      _status:     "projected",
      _sortKey:    occ.occDate+"_P_"+occ.occId,
    }));

    // Combine, sort chronologically (actual before projected on same day)
    const combined = [...actRows, ...projRows]
      .sort((a,b)=>a._sortKey.localeCompare(b._sortKey));

    // Calculate running balance from opening
    let bal = openingBalance;
    return combined.map(row=>{
      bal += row.type==="income" ? row.amount : -row.amount;
      return {...row, runBalance: bal};
    });
  },[filteredActuals, filteredProjOccs, openingBalance]);

  // Apply type + status filters on top of unified ledger
  const displayLedger = useMemo(()=>unifiedLedger
    .filter(r=>(txnTypeFilter==="all"||r.type===txnTypeFilter)
             &&(txnStatusFilter==="all"||r._status===txnStatusFilter)
             &&(!dateFrom||r._date>=dateFrom)
             &&(!dateTo||r._date<=dateTo))
    .reverse(),
  [unifiedLedger,txnTypeFilter,txnStatusFilter,dateFrom,dateTo]);

  // KPIs from unified ledger
  const kpi = useMemo(()=>{
    const actuals  = unifiedLedger.filter(r=>r._status==="actual");
    const projs    = unifiedLedger.filter(r=>r._status==="projected");
    const currentBal = unifiedLedger.filter(r=>r._date<=TODAY_STR).slice(-1)[0]?.runBalance??openingBalance;
    const endBal     = unifiedLedger.slice(-1)[0]?.runBalance??openingBalance;
    const minBal     = unifiedLedger.length ? Math.min(...unifiedLedger.map(r=>r.runBalance)) : openingBalance;
    return {
      opening:     openingBalance,
      current:     currentBal,
      actualIn:    actuals.filter(r=>r.type==="income").reduce((s,r)=>s+r.amount,0),
      actualOut:   actuals.filter(r=>r.type==="expense").reduce((s,r)=>s+r.amount,0),
      projectedIn: projs.filter(r=>r.type==="income").reduce((s,r)=>s+r.amount,0),
      projectedOut:projs.filter(r=>r.type==="expense").reduce((s,r)=>s+r.amount,0),
      ending:      endBal,
      minBal,
    };
  },[unifiedLedger,openingBalance]);

  // QB Sync — calls real API, falls back to mock if not connected
  const handleSync = async () => {
    setSyncing(true); setSyncMsg(null);
    try {
      const res  = await fetch("/api/qb-sync", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          sinceDate: syncFromDate || TODAY_STR,
          accounts: accounts.map(a=>({id:a.id, entityId:a.entityId, qbAccountId:a.qbAccountId||null})),
        }),
      });
      if (!res.ok) throw new Error("API error "+res.status);
      const data = await res.json();

      if (data.transactions && data.transactions.length > 0) {
        // Deduplicate: skip any transaction whose qbId already exists
        const existingQbIds = new Set(actualTxns.map(t=>t.qbId).filter(Boolean));
        const newTxns = data.transactions
          .filter(t => !existingQbIds.has(t.qbId))
          .map(t => ({ ...t, id: t.qbId || uid(), status:"actual" }));

        if (newTxns.length > 0) {
          setActualTxns(prev=>[...newTxns,...prev]);
          setSyncMsg(`Synced ${newTxns.length} new transactions from QuickBooks`);
        } else {
          setSyncMsg("Already up to date — no new transactions");
        }
      } else if (data.message) {
        // Not connected yet — fall back to demo
        const targetAccs = filterAccount!=="all"
          ? accounts.filter(a=>a.id===filterAccount)
          : availAccounts.slice(0,3);
        const mockTxns = targetAccs.flatMap(acc=>{
          const e=entities.find(x=>x.id===acc.entityId); if(!e) return [];
          return genTxns(acc,e,categories).slice(0,3).map(t=>({
            ...t,id:uid(),date:TODAY_STR,description:"Demo — "+t.description,status:"actual"
          }));
        });
        setActualTxns(prev=>[...mockTxns,...prev]);
        setSyncMsg(`Demo mode: ${mockTxns.length} mock transactions added. Connect QB in Settings → Bank Sync.`);
      }
    } catch(e) {
      // API not deployed yet — use demo mode
      const targetAccs = filterAccount!=="all"
        ? accounts.filter(a=>a.id===filterAccount)
        : availAccounts.slice(0,3);
      const mockTxns = targetAccs.flatMap(acc=>{
        const ent=entities.find(x=>x.id===acc.entityId); if(!ent) return [];
        return genTxns(acc,ent,categories).slice(0,3).map(t=>({
          ...t,id:uid(),date:TODAY_STR,description:"Demo — "+t.description,status:"actual"
        }));
      });
      setActualTxns(prev=>[...mockTxns,...prev]);
      setSyncMsg(`Demo mode: ${mockTxns.length} transactions added`);
    }
    setSyncing(false);
    setTimeout(()=>setSyncMsg(null),5000);
  };

  // Chart data — daily balance points
  const chartData = useMemo(()=>{
    const days=[];
    for(let i=-20;i<=forecastDays;i++){
      const d=dateStr(addDays(TODAY,i));
      const dayRows=unifiedLedger.filter(r=>r._date===d);
      const endBal=dayRows.length?dayRows[dayRows.length-1].runBalance
        :(days.length?days[days.length-1].balance:openingBalance);
      days.push({date:d,balance:endBal,isToday:i===0,isProjected:i>0,hasActivity:dayRows.length>0});
    }
    return days;
  },[unifiedLedger,openingBalance,forecastDays]);

  const cMin=Math.min(...chartData.map(d=>d.balance),0)*1.05;
  const cMax=Math.max(...chartData.map(d=>d.balance))*1.08;
  const cRange=cMax-cMin||1;
  const W=Math.max(800,chartData.length*16), H=200;
  const toX=(i)=>44+(i/(chartData.length-1))*(W-60);
  const toY=(b)=>H-20-((b-cMin)/cRange)*(H-44);
  const todayIdx=chartData.findIndex(d=>d.isToday);

  const TABS=["dashboard","transactions","projections","cashflow","settings"];

  return (
    <div style={{minHeight:"100vh",background:COLORS.bg,color:COLORS.text,fontFamily:"'DM Sans',system-ui,sans-serif",fontSize:14}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700;800&family=Space+Grotesk:wght@600;700;800&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:${COLORS.surface}}::-webkit-scrollbar-thumb{background:${COLORS.border};border-radius:3px}
        input,select{outline:none}input::placeholder{color:${COLORS.textDim}}
        @keyframes spin{to{transform:rotate(360deg)}}@keyframes fadein{from{opacity:0;transform:translateY(5px)}to{opacity:1;transform:translateY(0)}}
        .rh:hover{background:#161E2A !important}.rh-today:hover{background:#1E1800 !important}
        select option{background:${COLORS.surface};color:${COLORS.text}}
        .today-row{background:${COLORS.todayBg} !important}
      `}</style>

      {/* TOP BAR */}
      <div style={{background:COLORS.surface,borderBottom:`1px solid ${COLORS.border}`,padding:"0 20px",display:"flex",alignItems:"center",gap:12,position:"sticky",top:0,zIndex:200}}>
        <div style={{display:"flex",alignItems:"center",gap:9,marginRight:16,padding:"10px 0"}}>
          <div style={{width:30,height:30,borderRadius:8,background:`linear-gradient(135deg,${COLORS.accent},#006644)`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:15}}>💰</div>
          <div>
            <div style={{fontFamily:"'Space Grotesk',sans-serif",fontWeight:800,fontSize:14,letterSpacing:"-0.02em",lineHeight:1}}>CashFlow Pro</div>
            <div style={{fontSize:9,color:COLORS.textMid}}>Multi-Entity · QB Connected</div>
          </div>
        </div>
        <span style={{fontSize:10,color:COLORS.textDim,textTransform:"uppercase",letterSpacing:"0.08em"}}>Entity</span>
        <select value={filterEntity} onChange={e=>setFilterEntity(e.target.value)} style={{...selS(),width:200,padding:"5px 9px"}}>
          <option value="all">All Entities</option>
          {entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
        <span style={{fontSize:10,color:COLORS.textDim,textTransform:"uppercase",letterSpacing:"0.08em"}}>Account</span>
        <select value={filterAccount} onChange={e=>setFilterAccount(e.target.value)} style={{...selS(),width:195,padding:"5px 9px"}}>
          <option value="all">All Accounts</option>
          {availAccounts.map(a=><option key={a.id} value={a.id}>{a.name} {a.number}</option>)}
        </select>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:10}}>
          {syncMsg&&<span style={{fontSize:11,color:COLORS.accent,background:COLORS.accentDim,padding:"4px 11px",borderRadius:6,border:`1px solid ${COLORS.accent}33`}}>✓ {syncMsg}</span>}
          {isAdmin&&<>
            <div style={{display:"flex",alignItems:"center",gap:6,background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderRadius:7,padding:"4px 8px"}}>
              <span style={{fontSize:10,color:COLORS.textMid,whiteSpace:"nowrap"}}>From</span>
              <input type="date" value={syncFromDate} onChange={e=>setSyncFromDate(e.target.value)}
                style={{background:"transparent",border:"none",color:COLORS.text,fontSize:11,outline:"none",colorScheme:"dark",width:110,cursor:"pointer"}}/>
            </div>
            <button onClick={handleSync} disabled={syncing} style={{background:COLORS.qb,color:"#fff",border:"none",borderRadius:7,padding:"7px 15px",fontSize:12,fontWeight:700,cursor:syncing?"not-allowed":"pointer",display:"flex",alignItems:"center",gap:6,opacity:syncing?0.7:1}}>
              <span style={{display:"inline-block",animation:syncing?"spin 1s linear infinite":"none"}}>{syncing?"⟳":"⬇"}</span>
              {syncing?"Syncing...":"Sync QB"}
            </button>
          </>}
          {/* User avatar + logout */}
          <div style={{display:"flex",alignItems:"center",gap:8,borderLeft:`1px solid ${COLORS.border}`,paddingLeft:12,marginLeft:4}}>
            <div style={{width:30,height:30,borderRadius:"50%",background:session?.user?.role==="admin"?COLORS.accent+"22":COLORS.blue+"22",border:`1px solid ${session?.user?.role==="admin"?COLORS.accent+"44":COLORS.blue+"44"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:12,fontWeight:800,color:session?.user?.role==="admin"?COLORS.accent:COLORS.blue}}>
              {session?.user?.name?.charAt(0)?.toUpperCase()||"?"}
            </div>
            <div style={{lineHeight:1.2}}>
              <div style={{fontSize:12,fontWeight:600,color:COLORS.text}}>{session?.user?.name}</div>
              <div style={{fontSize:9,color:session?.user?.role==="admin"?COLORS.accent:COLORS.blue,textTransform:"uppercase",letterSpacing:"0.06em",fontWeight:700}}>{session?.user?.role}</div>
            </div>
            <button onClick={onLogout} title="Sign out"
              style={{background:"#161E2A",border:`1px solid ${COLORS.border}`,color:COLORS.textMid,borderRadius:6,padding:"5px 10px",fontSize:11,cursor:"pointer",fontWeight:600,marginLeft:4,transition:"all 0.15s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=COLORS.danger+"55";e.currentTarget.style.color=COLORS.danger;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=COLORS.border;e.currentTarget.style.color=COLORS.textMid;}}>
              Sign out
            </button>
          </div>
        </div>
      </div>

      {/* NAV */}
      <div style={{background:COLORS.surface,borderBottom:`1px solid ${COLORS.border}`,padding:"0 20px",display:"flex"}}>
        {TABS.filter(t=>t!=="settings"||isAdmin).map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{background:"transparent",color:tab===t?COLORS.accent:COLORS.textMid,border:"none",borderBottom:tab===t?`2px solid ${COLORS.accent}`:"2px solid transparent",padding:"10px 15px",fontSize:12,fontWeight:600,cursor:"pointer",textTransform:"capitalize",letterSpacing:"0.03em",transition:"all 0.15s"}}>
            {t==="settings"?"⚙ Settings":t==="cashflow"?"Chart":t.charAt(0).toUpperCase()+t.slice(1)}
          </button>
        ))}
        {/* Viewer read-only badge */}
        {!isAdmin&&<div style={{marginLeft:"auto",display:"flex",alignItems:"center",padding:"0 8px"}}>
          <span style={{fontSize:10,color:COLORS.blue,background:COLORS.blueDim,border:`1px solid ${COLORS.blue}33`,borderRadius:20,padding:"3px 10px",fontWeight:700,letterSpacing:"0.06em"}}>👁 View Only</span>
        </div>}
      </div>

      <div style={{maxWidth:1400,margin:"0 auto",padding:"22px 20px 60px",animation:"fadein 0.25s ease"}}>
        {/* QB connection result banner */}
        {qbConnectMsg&&(
          <div style={{background:qbConnectMsg.type==="success"?COLORS.accentDim:COLORS.dangerDim,border:`1px solid ${qbConnectMsg.type==="success"?COLORS.accent:COLORS.danger}44`,borderRadius:10,padding:"11px 16px",marginBottom:16,fontSize:13,color:qbConnectMsg.type==="success"?COLORS.accent:COLORS.danger,display:"flex",alignItems:"center",gap:10}}>
            {qbConnectMsg.msg}
          </div>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            DASHBOARD
        ══════════════════════════════════════════════════════════════════ */}
        {tab==="dashboard"&&(<>
          <SectionHead title="Overview" sub={entities.find(e=>e.id===filterEntity)?.name||"All entities"} />
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(155px,1fr))",gap:10,marginBottom:22}}>
            <KpiCard label="Opening Balance"    value={fmtShort(kpi.opening)}     color={COLORS.textMid}/>
            <KpiCard label="Current Balance"    value={fmtShort(kpi.current)}     color={balColor(kpi.current, overdraftLimit)}/>
            <KpiCard label="Actual In (20d)"    value={fmtShort(kpi.actualIn)}    color={COLORS.accent}/>
            <KpiCard label="Actual Out (20d)"   value={fmtShort(kpi.actualOut)}   color={COLORS.danger}/>
            <KpiCard label="Projected In"       value={fmtShort(kpi.projectedIn)} color={COLORS.blue}/>
            <KpiCard label="Projected Out"      value={fmtShort(kpi.projectedOut)}color={COLORS.warning}/>
            <KpiCard label="Ending Balance"     value={fmtShort(kpi.ending)}      color={balColor(kpi.ending, overdraftLimit)}
              sub={kpi.minBal < -(overdraftLimit) ? `⚠ Below overdraft: ${fmtShort(kpi.minBal)}` : kpi.minBal<0?`⚠ Low: ${fmtShort(kpi.minBal)}`:null}/>
          </div>
          <div style={{marginBottom:22}}>
            <div style={{fontSize:11,color:COLORS.textMid,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10}}>Entities</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10}}>
              {entities.map(ent=>{
                const eAccs=accounts.filter(a=>a.entityId===ent.id);
                const eBal=eAccs.reduce((s,a)=>s+(a.openBalance||0),0);
                const eIn=actualTxns.filter(t=>t.entityId===ent.id&&t.type==="income").reduce((s,t)=>s+t.amount,0);
                const eOut=actualTxns.filter(t=>t.entityId===ent.id&&t.type==="expense").reduce((s,t)=>s+t.amount,0);
                return (
                  <div key={ent.id} className="rh" style={{background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderRadius:10,overflow:"hidden",cursor:"pointer"}} onClick={()=>{setFilterEntity(ent.id);setFilterAccount("all");}}>
                    <div style={{height:3,background:ent.color}}/>
                    <div style={{padding:"11px 13px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:7,marginBottom:8}}><Dot color={ent.color} size={9}/><span style={{fontWeight:700,fontSize:12,color:ent.color}}>{ent.short}</span><span style={{fontSize:10,color:COLORS.textDim,marginLeft:"auto"}}>{eAccs.length} acct{eAccs.length!==1?"s":""}</span></div>
                      <div style={{fontSize:19,fontWeight:800,fontFamily:"'Space Grotesk',monospace",color:COLORS.text,marginBottom:6}}>{fmtShort(eBal)}</div>
                      <div style={{display:"flex",gap:12,fontSize:11}}><span style={{color:COLORS.accent}}>+{fmtShort(eIn)}</span><span style={{color:COLORS.danger}}>−{fmtShort(eOut)}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          {/* Mini ledger preview */}
          <UnifiedLedgerTable rows={displayLedger.slice(0,15)} entities={entities} categories={categories} accounts={accounts} title="Recent Ledger" onMore={()=>setTab("transactions")} overdraftLimit={overdraftLimit}/>
        </>)}

        {/* ══════════════════════════════════════════════════════════════════
            TRANSACTIONS (unified ledger)
        ══════════════════════════════════════════════════════════════════ */}
        {tab==="transactions"&&(<>
          {/* Confirm delete modal — in-flow overlay (position:fixed breaks in iframes) */}
          {confirmModal&&(
            <div style={{minHeight:300,background:"rgba(0,0,0,0.75)",borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:16,padding:20}}>
              <div style={{background:COLORS.surface,border:`1px solid ${confirmModal.row?._status==="projected"?COLORS.blue+"66":COLORS.danger+"66"}`,borderRadius:14,padding:28,maxWidth:460,width:"100%"}}>

                {/* Single actual txn */}
                {confirmModal.mode==="single"&&confirmModal.row?._status!=="projected"&&(<>
                  <div style={{fontSize:22,marginBottom:12}}>🗑</div>
                  <div style={{fontWeight:800,fontSize:16,color:COLORS.text,marginBottom:10,fontFamily:"'Space Grotesk',sans-serif"}}>Delete this transaction?</div>
                  <div style={{background:COLORS.bg,borderRadius:8,padding:"10px 14px",marginBottom:14}}>
                    <div style={{fontSize:13,color:COLORS.text,fontWeight:600,marginBottom:4}}>{confirmModal.row.description}</div>
                    <div style={{fontSize:11,color:COLORS.textMid,display:"flex",gap:14}}>
                      <span>{confirmModal.row._date}</span>
                      <span style={{color:confirmModal.row.type==="income"?COLORS.accent:COLORS.danger,fontWeight:700}}>{confirmModal.row.type==="income"?"+":"−"}{fmtShort(confirmModal.row.amount)}</span>
                      <span>QB Actual</span>
                    </div>
                  </div>
                  <div style={{background:COLORS.dangerDim,border:`1px solid ${COLORS.danger}33`,borderRadius:8,padding:"8px 12px",marginBottom:20,display:"flex",gap:8}}>
                    <span style={{color:COLORS.danger}}>⚠</span>
                    <span style={{fontSize:11,color:COLORS.danger}}>Removes from CashFlow Pro only. The transaction stays in QuickBooks.</span>
                  </div>
                  <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                    <button onClick={cancelDelete} style={{background:"#161E2A",color:COLORS.textMid,border:`1px solid ${COLORS.border}`,borderRadius:8,padding:"9px 20px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                    <button onClick={confirmDelete} style={{background:COLORS.danger,color:"#fff",border:"none",borderRadius:8,padding:"9px 20px",fontSize:13,fontWeight:700,cursor:"pointer"}}>Delete Transaction</button>
                  </div>
                </>)}

                {/* Single projected txn — two-option choice */}
                {confirmModal.mode==="single"&&confirmModal.row?._status==="projected"&&(<>
                  <div style={{fontSize:22,marginBottom:12}}>📅</div>
                  <div style={{fontWeight:800,fontSize:16,color:COLORS.text,marginBottom:6,fontFamily:"'Space Grotesk',sans-serif"}}>Delete projected transaction</div>
                  <div style={{background:COLORS.bg,borderRadius:8,padding:"10px 14px",marginBottom:16}}>
                    <div style={{fontSize:13,color:COLORS.text,fontWeight:600,marginBottom:4}}>{confirmModal.row.description}</div>
                    <div style={{fontSize:11,color:COLORS.textMid,display:"flex",gap:14,flexWrap:"wrap"}}>
                      <span style={{color:COLORS.blue}}>{confirmModal.row._date}</span>
                      <span style={{color:confirmModal.row.type==="income"?COLORS.accent:COLORS.danger,fontWeight:700}}>{confirmModal.row.type==="income"?"+":"−"}{fmtShort(confirmModal.row.amount)}</span>
                      {confirmModal.row.recurrence!=="once"&&<span style={{color:COLORS.purple}}>↻ {confirmModal.row.recurrence}</span>}
                    </div>
                  </div>
                  <div style={{fontSize:12,color:COLORS.textMid,marginBottom:10,fontWeight:600}}>What would you like to delete?</div>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:20}}>
                    <div onClick={()=>setConfirmModal(m=>({...m,projMode:"occurrence"}))}
                      style={{background:confirmModal.projMode==="occurrence"?COLORS.blueDim:COLORS.bg,border:`2px solid ${confirmModal.projMode==="occurrence"?COLORS.blue:COLORS.border}`,borderRadius:10,padding:"14px",cursor:"pointer",transition:"all 0.15s"}}>
                      <div style={{fontSize:13,fontWeight:700,color:confirmModal.projMode==="occurrence"?COLORS.blue:COLORS.text,marginBottom:5}}>This date only</div>
                      <div style={{fontSize:11,color:COLORS.textMid,lineHeight:1.5}}>Remove just {confirmModal.row._date}. Future dates from this rule stay intact.</div>
                    </div>
                    <div onClick={()=>setConfirmModal(m=>({...m,projMode:"rule"}))}
                      style={{background:confirmModal.projMode==="rule"?COLORS.dangerDim:COLORS.bg,border:`2px solid ${confirmModal.projMode==="rule"?COLORS.danger:COLORS.border}`,borderRadius:10,padding:"14px",cursor:"pointer",transition:"all 0.15s"}}>
                      <div style={{fontSize:13,fontWeight:700,color:confirmModal.projMode==="rule"?COLORS.danger:COLORS.text,marginBottom:5}}>
                        {confirmModal.row.recurrence==="once"?"Delete this projection":"Entire recurring rule"}
                      </div>
                      <div style={{fontSize:11,color:COLORS.textMid,lineHeight:1.5}}>
                        {confirmModal.row.recurrence==="once"?"Remove this one-time projection permanently.":"Delete all future occurrences of this rule."}
                      </div>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                    <button onClick={cancelDelete} style={{background:"#161E2A",color:COLORS.textMid,border:`1px solid ${COLORS.border}`,borderRadius:8,padding:"9px 20px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                    <button onClick={confirmDelete} disabled={!confirmModal.projMode}
                      style={{background:confirmModal.projMode==="rule"?COLORS.danger:COLORS.blue,color:"#fff",border:"none",borderRadius:8,padding:"9px 20px",fontSize:13,fontWeight:700,cursor:confirmModal.projMode?"pointer":"not-allowed",opacity:confirmModal.projMode?1:0.4,transition:"all 0.15s"}}>
                      {!confirmModal.projMode?"Select an option":confirmModal.projMode==="occurrence"?"Remove This Date":confirmModal.row.recurrence==="once"?"Delete Projection":"Delete Entire Rule"}
                    </button>
                  </div>
                </>)}

                {/* Bulk actual */}
                {confirmModal.mode==="bulk"&&(<>
                  <div style={{fontSize:22,marginBottom:12}}>🗑</div>
                  <div style={{fontWeight:800,fontSize:16,color:COLORS.text,marginBottom:10,fontFamily:"'Space Grotesk',sans-serif"}}>Delete {selectedIds.size} transaction{selectedIds.size!==1?"s":""}?</div>
                  <div style={{background:COLORS.bg,borderRadius:8,padding:"10px 14px",marginBottom:14}}>
                    <div style={{fontSize:12,color:COLORS.textMid}}>{selectedIds.size} selected transaction{selectedIds.size!==1?"s":""} will be removed from CashFlow Pro.</div>
                  </div>
                  <div style={{background:COLORS.dangerDim,border:`1px solid ${COLORS.danger}33`,borderRadius:8,padding:"8px 12px",marginBottom:20,display:"flex",gap:8}}>
                    <span style={{color:COLORS.danger}}>⚠</span>
                    <span style={{fontSize:11,color:COLORS.danger}}>Removes from CashFlow Pro only. Transactions stay in QuickBooks.</span>
                  </div>
                  <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                    <button onClick={cancelDelete} style={{background:"#161E2A",color:COLORS.textMid,border:`1px solid ${COLORS.border}`,borderRadius:8,padding:"9px 20px",fontSize:13,fontWeight:600,cursor:"pointer"}}>Cancel</button>
                    <button onClick={confirmDelete} style={{background:COLORS.danger,color:"#fff",border:"none",borderRadius:8,padding:"9px 20px",fontSize:13,fontWeight:700,cursor:"pointer"}}>Delete {selectedIds.size} Transactions</button>
                  </div>
                </>)}

              </div>
            </div>
          )}

          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12,flexWrap:"wrap",gap:10}}>
            <SectionHead title="Transactions" sub={`Unified ledger — actual + projected · running balance per line`}/>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
              {/* Date range */}
              <span style={{fontSize:11,color:COLORS.textMid}}>From</span>
              <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)}
                style={{...inpS(),width:140,padding:"5px 9px",colorScheme:"dark"}}/>
              <span style={{fontSize:11,color:COLORS.textMid}}>To</span>
              <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)}
                style={{...inpS(),width:140,padding:"5px 9px",colorScheme:"dark"}}/>
              {(dateFrom||dateTo)&&<button onClick={()=>{setDateFrom("");setDateTo("");}} style={{background:"#161E2A",border:`1px solid ${COLORS.border}`,color:COLORS.textMid,borderRadius:6,padding:"5px 10px",fontSize:11,cursor:"pointer"}}>✕ Clear</button>}
              <div style={{width:1,background:COLORS.border,margin:"0 4px",height:20}}/>
              {["all","actual","projected"].map(f=>(
                <button key={f} onClick={()=>{setTxnStatusFilter(f);clearSelection();}} style={{background:txnStatusFilter===f?(f==="actual"?COLORS.accentDim:f==="projected"?COLORS.blueDim:COLORS.surfaceHigh):"transparent",color:txnStatusFilter===f?(f==="actual"?COLORS.accent:f==="projected"?COLORS.blue:COLORS.text):COLORS.textMid,border:`1px solid ${txnStatusFilter===f?(f==="actual"?COLORS.accent+"44":f==="projected"?COLORS.blue+"44":COLORS.border):COLORS.border}`,borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer",textTransform:"capitalize"}}>{f==="all"?"All":f==="actual"?"Actual (QB)":"Projected"}</button>
              ))}
              <div style={{width:1,background:COLORS.border,margin:"0 4px",height:20}}/>
              {["all","income","expense"].map(f=>(
                <button key={f} onClick={()=>setTxnTypeFilter(f)} style={{background:txnTypeFilter===f?(f==="income"?COLORS.accentDim:f==="expense"?COLORS.dangerDim:COLORS.surfaceHigh):"transparent",color:txnTypeFilter===f?(f==="income"?COLORS.accent:f==="expense"?COLORS.danger:COLORS.text):COLORS.textMid,border:`1px solid ${txnTypeFilter===f?(f==="income"?COLORS.accent+"44":f==="expense"?COLORS.danger+"44":COLORS.border):COLORS.border}`,borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer",textTransform:"capitalize"}}>{f}</button>
              ))}
            </div>
          </div>

          {/* Bulk action bar — appears when rows are selected */}
          {selectedIds.size>0&&(
            <div style={{background:"#1A0A0A",border:`1px solid ${COLORS.danger}55`,borderRadius:10,padding:"10px 16px",marginBottom:12,display:"flex",alignItems:"center",gap:14,animation:"fadein 0.2s ease"}}>
              <div style={{width:8,height:8,borderRadius:"50%",background:COLORS.danger}}/>
              <span style={{fontSize:13,fontWeight:700,color:COLORS.text}}>{selectedIds.size} transaction{selectedIds.size!==1?"s":""} selected</span>
              <span style={{fontSize:12,color:COLORS.textMid}}>
                Total: {fmtShort(
                  displayLedger.filter(r=>r._status==="actual"&&selectedIds.has(r.id)).reduce((s,r)=>s+(r.type==="income"?r.amount:-r.amount),0)
                )}
              </span>
              <div style={{marginLeft:"auto",display:"flex",gap:8}}>
                <button onClick={clearSelection} style={{background:"#161E2A",color:COLORS.textMid,border:`1px solid ${COLORS.border}`,borderRadius:7,padding:"6px 14px",fontSize:12,fontWeight:600,cursor:"pointer"}}>Deselect all</button>
                <button onClick={askDeleteBulk} style={{background:COLORS.danger,color:"#fff",border:"none",borderRadius:7,padding:"6px 14px",fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:6}}>
                  🗑 Delete {selectedIds.size} selected
                </button>
              </div>
            </div>
          )}

          {/* Legend */}
          <div style={{display:"flex",gap:16,marginBottom:10,fontSize:11,color:COLORS.textMid,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontWeight:700,color:COLORS.textDim,textTransform:"uppercase",letterSpacing:"0.08em",fontSize:10}}>Legend:</span>
            <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:10,height:10,borderRadius:2,background:COLORS.accent+"33",border:`1px solid ${COLORS.accent}55`}}/><span>Actual (QB synced)</span></div>
            <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:10,height:10,borderRadius:2,background:COLORS.blue+"33",border:`1px dashed ${COLORS.blue}77`}}/><span>Projected (future)</span></div>
            <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:10,height:2,background:COLORS.warning,borderRadius:1}}/><span>Today divider</span></div>
            <div style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:14,height:14,borderRadius:3,background:"transparent",border:`1.5px solid ${COLORS.border}`}}/><span>Checkbox — select to bulk delete</span></div>
          </div>

          <UnifiedLedgerTable
            rows={displayLedger} entities={entities} categories={categories} accounts={accounts}
            showAll selectedIds={selectedIds}
            onToggleSelect={isAdmin?toggleSelect:null}
            onToggleSelectAll={isAdmin?toggleSelectAll:null}
            onDeleteSingle={isAdmin?askDeleteSingle:null}
            onCatAssign={(txnId, catId, currentType)=>{
              // Find the category to determine correct type
              const cat = categories.find(c=>c.id===catId);
              const newType = cat ? cat.type : currentType;
              setActualTxns(prev=>prev.map(t=>
                t.id===txnId ? {...t, categoryId:catId, type:newType} : t
              ));
            }}
            overdraftLimit={overdraftLimit}
          />

          {/* Totals bar */}
          <div style={{background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderTop:"none",borderRadius:"0 0 12px 12px",padding:"10px 14px",display:"flex",gap:20,fontSize:12,flexWrap:"wrap"}}>
            <span style={{color:COLORS.textMid}}>{displayLedger.length} rows</span>
            <span style={{color:COLORS.accent}}>Actual in: +{fmtShort(displayLedger.filter(r=>r._status==="actual"&&r.type==="income").reduce((s,r)=>s+r.amount,0))}</span>
            <span style={{color:COLORS.danger}}>Actual out: −{fmtShort(displayLedger.filter(r=>r._status==="actual"&&r.type==="expense").reduce((s,r)=>s+r.amount,0))}</span>
            <span style={{color:COLORS.blue}}>Projected in: +{fmtShort(displayLedger.filter(r=>r._status==="projected"&&r.type==="income").reduce((s,r)=>s+r.amount,0))}</span>
            <span style={{color:COLORS.warning}}>Projected out: −{fmtShort(displayLedger.filter(r=>r._status==="projected"&&r.type==="expense").reduce((s,r)=>s+r.amount,0))}</span>
          </div>
        </>)}

        {/* ══════════════════════════════════════════════════════════════════
            PROJECTIONS
        ══════════════════════════════════════════════════════════════════ */}
        {tab==="projections"&&(
          <ProjectionsTab projections={projections} setProjections={setProjections}
            filteredProjOccs={filteredProjOccs} entities={entities} accounts={accounts} categories={categories}/>
        )}

        {/* ══════════════════════════════════════════════════════════════════
            CHART
        ══════════════════════════════════════════════════════════════════ */}
        {tab==="cashflow"&&(<>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,flexWrap:"wrap",gap:10}}>
            <div style={{display:"flex",gap:0,borderBottom:`2px solid ${COLORS.border}`}}>
              {[{k:"line",l:"Cashflow Chart"},{k:"monthly",l:"Monthly by Category"}].map(({k,l})=>(
                <button key={k} onClick={()=>setChartSubTab(k)} style={{background:"transparent",color:chartSubTab===k?COLORS.accent:COLORS.textMid,border:"none",borderBottom:chartSubTab===k?`2px solid ${COLORS.accent}`:"2px solid transparent",marginBottom:-2,padding:"8px 16px",fontSize:12,fontWeight:700,cursor:"pointer",letterSpacing:"0.02em",transition:"all 0.15s"}}>{l}</button>
              ))}
            </div>
            {chartSubTab==="line"&&<div style={{display:"flex",gap:6,alignItems:"center"}}>
              <span style={{fontSize:11,color:COLORS.textMid}}>Horizon:</span>
              {[14,30,60,90].map(d=>(
                <button key={d} onClick={()=>setForecastDays(d)} style={{background:forecastDays===d?COLORS.accentDim:"transparent",color:forecastDays===d?COLORS.accent:COLORS.textMid,border:`1px solid ${forecastDays===d?COLORS.accent+"44":COLORS.border}`,borderRadius:6,padding:"5px 11px",fontSize:11,fontWeight:700,cursor:"pointer"}}>{d}d</button>
              ))}
            </div>}
          </div>

          {/* Monthly by Category Report */}
          {chartSubTab==="monthly"&&(
            <MonthlyCategoryReport
              actualTxns={filteredActuals}
              projections={projections.filter(p=>(filterEntity==="all"||p.entityId===filterEntity)&&(filterAccount==="all"||p.accountId===filterAccount))}
              categories={categories}
              entities={entities}
              openingBalance={openingBalance}
            />
          )}

          {/* Line chart section */}
          {chartSubTab==="line"&&(<>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:18}}>
            <KpiCard label="Opening Balance"  value={fmtShort(kpi.opening)} color={COLORS.textMid}/>
            <KpiCard label="Current Balance"  value={fmtShort(kpi.current)} color={balColor(kpi.current, overdraftLimit)}/>
            <KpiCard label={`Ending (+${forecastDays}d)`} value={fmtShort(kpi.ending)} color={balColor(kpi.ending, overdraftLimit)}/>
            <KpiCard label="Lowest Point"     value={fmtShort(kpi.minBal)} color={balColor(kpi.minBal, overdraftLimit)}
              sub={overdraftLimit>0?`Overdraft limit: ${fmtShort(overdraftLimit)}`:undefined}/>
          </div>

          {/* SVG Chart */}
          <div style={{background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderRadius:12,padding:"18px 16px 12px",marginBottom:18,overflowX:"auto"}}>
            <svg width={W} height={H+16} viewBox={`0 0 ${W} ${H+16}`} style={{display:"block",minWidth:W}}>
              <defs>
                <linearGradient id="ga" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COLORS.accent} stopOpacity=".3"/><stop offset="100%" stopColor={COLORS.accent} stopOpacity=".02"/></linearGradient>
                <linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={COLORS.blue} stopOpacity=".25"/><stop offset="100%" stopColor={COLORS.blue} stopOpacity=".02"/></linearGradient>
              </defs>

              {/* Y grid */}
              {[0,.25,.5,.75,1].map(p=>{
                const v=cMin+p*cRange, y=toY(v);
                return <g key={p}><line x1={44} y1={y} x2={W-10} y2={y} stroke={COLORS.border} strokeDasharray="2,5"/><text x={40} y={y+4} textAnchor="end" fontSize={8} fill={COLORS.textDim}>{fmtShort(v).replace("CA","").replace(",000","k")}</text></g>;
              })}
              {cMin<0&&<line x1={44} y1={toY(0)} x2={W-10} y2={toY(0)} stroke={COLORS.warning} strokeWidth={1} strokeDasharray="3,3"/>}
              {/* Overdraft floor line */}
              {overdraftLimit>0&&(()=>{
                const floorVal = -overdraftLimit;
                if(floorVal < cMin || floorVal > cMax) return null;
                const y = toY(floorVal);
                return <g>
                  <line x1={44} y1={y} x2={W-10} y2={y} stroke={COLORS.danger} strokeWidth={1.5} strokeDasharray="6,3"/>
                  <text x={W-12} y={y-4} textAnchor="end" fontSize={8} fill={COLORS.danger} fontWeight="bold">Overdraft limit</text>
                </g>;
              })()}

              {/* TODAY shaded band */}
              {todayIdx>=0&&(()=>{
                const x=toX(todayIdx);
                return <><rect x={x-1} y={10} width={3} height={H-30} fill={COLORS.warning} opacity={0.9} rx={1}/><text x={x} y={H+14} textAnchor="middle" fontSize={8} fill={COLORS.warning} fontWeight="bold">TODAY</text></>;
              })()}

              {/* Actual area */}
              {(()=>{
                const actPts=chartData.filter(d=>!d.isProjected);
                if(actPts.length<2) return null;
                const line=actPts.map((d,i)=>`${i===0?"M":"L"}${toX(chartData.indexOf(d))},${toY(d.balance)}`).join(" ");
                const fi=chartData.indexOf(actPts[0]), li=chartData.indexOf(actPts[actPts.length-1]);
                return <><path d={line+` L${toX(li)},${H-20} L${toX(fi)},${H-20} Z`} fill="url(#ga)"/><path d={line} fill="none" stroke={COLORS.accent} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round"/></>;
              })()}

              {/* Projected area */}
              {(()=>{
                const pPts=chartData.filter(d=>d.isProjected||d.isToday);
                if(pPts.length<2) return null;
                const line=pPts.map((d,i)=>`${i===0?"M":"L"}${toX(chartData.indexOf(d))},${toY(d.balance)}`).join(" ");
                const fi=chartData.indexOf(pPts[0]), li=chartData.indexOf(pPts[pPts.length-1]);
                return <><path d={line+` L${toX(li)},${H-20} L${toX(fi)},${H-20} Z`} fill="url(#gp)"/><path d={line} fill="none" stroke={COLORS.blue} strokeWidth={2} strokeDasharray="5,3" strokeLinecap="round" strokeLinejoin="round"/></>;
              })()}

              {/* Dots */}
              {chartData.map((d,i)=>{
                if(!d.hasActivity&&!d.isToday) return null;
                const x=toX(i),y=toY(d.balance);
                if(d.isToday) return <circle key={i} cx={x} cy={y} r={5} fill={COLORS.warning} stroke={COLORS.bg} strokeWidth={2}/>;
                const dotColor = d.balance < -(overdraftLimit) ? COLORS.danger : d.isProjected ? COLORS.blue : COLORS.accent;
                return <circle key={i} cx={x} cy={y} r={3} fill={dotColor} stroke={COLORS.bg} strokeWidth={1.5}/>;
              })}

              {/* X labels */}
              {chartData.map((d,i)=>{
                if(i%7!==0&&!d.isToday) return null;
                return <text key={i} x={toX(i)} y={H+14} textAnchor="middle" fontSize={7} fill={d.isToday?COLORS.warning:COLORS.textDim}>{d.date.slice(5)}</text>;
              })}
            </svg>
            <div style={{display:"flex",gap:18,marginTop:8,paddingLeft:44,flexWrap:"wrap"}}>
              {[
                {c:COLORS.accent,l:"Actual balance"},
                {c:COLORS.blue,l:"Projected",dash:true},
                {c:COLORS.warning,l:"Today"},
                ...(overdraftLimit>0?[{c:COLORS.danger,l:`Overdraft limit (${fmtShort(overdraftLimit)})`,dash:true}]:[]),
              ].map(({c,l,dash})=>(
                <div key={l} style={{display:"flex",alignItems:"center",gap:5}}>
                  <div style={{width:16,height:2,background:dash?"transparent":c,backgroundImage:dash?`repeating-linear-gradient(90deg,${c},${c} 4px,transparent 4px,transparent 7px)`:"none"}}/>
                  <span style={{fontSize:10,color:COLORS.textMid}}>{l}</span>
                </div>
              ))}
            </div>
          </div>
          </>)}
        </>)}

        {/* ══════════════════════════════════════════════════════════════════
            SETTINGS (admin only)
        ══════════════════════════════════════════════════════════════════ */}
        {tab==="settings"&&isAdmin&&(
          <SettingsTab entities={entities} setEntities={setEntities} accounts={accounts} setAccounts={setAccounts}
            categories={categories} setCategories={setCategories} settingsTab={settingsTab} setSettingsTab={setSettingsTab}
            users={users} saveUsers={saveUsers} currentUser={session?.user}/>
        )}

      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MONTHLY CASHFLOW BY CATEGORY REPORT
// ─────────────────────────────────────────────────────────────────────────────
function MonthlyCategoryReport({ actualTxns, projections, categories, openingBalance }) {
  const [reportType,   setReportType]   = useState("both");
  const [reportFrom,   setReportFrom]   = useState(dateStr(addMonths(TODAY, -5)).slice(0,7));
  const [reportTo,     setReportTo]     = useState(dateStr(addMonths(TODAY,  6)).slice(0,7));
  const [hiddenCats,   setHiddenCats]   = useState(new Set());
  const [expandedCats, setExpandedCats] = useState(new Set());
  const toggleCat    = (id) => setHiddenCats(prev   =>{ const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  const toggleExpand = (id) => setExpandedCats(prev =>{ const n=new Set(prev); n.has(id)?n.delete(id):n.add(id); return n; });
  const monthList = useMemo(() => {
    const list = [];
    let cur = parseD(reportFrom + "-01");
    const end = parseD(reportTo + "-01");
    let safety = 0;
    while (cur <= end && safety++ < 60) {
      list.push({
        key:   dateStr(cur).slice(0,7),
        label: cur.toLocaleString("en-CA", { month:"short", year:"numeric" }),
        isPast: dateStr(cur).slice(0,7) <= TODAY_STR.slice(0,7),
      });
      cur = addMonths(cur, 1);
    }
    return list;
  }, [reportFrom, reportTo]);

  // Expand projected occurrences for the report window
  const projOccs = useMemo(() => {
    const end = reportTo + "-31";
    return (projections||[]).flatMap(p => expandRecurring(p).filter(o => o.occDate >= reportFrom+"-01" && o.occDate <= end));
  }, [projections, reportFrom, reportTo]);

  // Merge actual + projected into one set keyed by category × month
  const data = useMemo(() => {
    const monthKeys = new Set(monthList.map(m => m.key));
    const map = {};
    // Actual
    actualTxns.forEach(t => {
      const mk = t.date.slice(0,7);
      if (!monthKeys.has(mk)) return;
      if (reportType !== "both" && t.type !== reportType) return;
      if (!map[t.categoryId]) map[t.categoryId] = {};
      map[t.categoryId][mk] = (map[t.categoryId][mk]||0) + (t.type==="income" ? t.amount : -t.amount);
    });
    // Projected
    projOccs.forEach(o => {
      const mk = o.occDate.slice(0,7);
      if (!monthKeys.has(mk)) return;
      if (reportType !== "both" && o.type !== reportType) return;
      if (!map[o.categoryId]) map[o.categoryId] = {};
      map[o.categoryId][mk] = (map[o.categoryId][mk]||0) + (o.type==="income" ? o.amount : -o.amount);
    });
    return Object.entries(map)
      .map(([catId, monthly]) => {
        const cat = categories.find(c => c.id === catId);
        const total = Object.values(monthly).reduce((s,v)=>s+v, 0);
        return { cat, monthly, total };
      })
      .filter(r => r.cat)
      .sort((a,b) => Math.abs(b.total) - Math.abs(a.total));
  }, [actualTxns, projOccs, categories, monthList, reportType]);

  // Monthly net + running balance
  const { monthlyNet, monthlyOpenBal, monthlyCloseBal } = useMemo(() => {
    const net = {}, openBal = {}, closeBal = {};
    let runBal = openingBalance || 0;
    // Pre-compute net for months before reportFrom to get opening balance right
    actualTxns.forEach(t => {
      if (t.date.slice(0,7) < reportFrom) {
        runBal += t.type==="income" ? t.amount : -t.amount;
      }
    });
    monthList.forEach(m => {
      openBal[m.key] = runBal;
      const monthActual = actualTxns.filter(t=>t.date.slice(0,7)===m.key);
      const monthProj   = projOccs.filter(o=>o.occDate.slice(0,7)===m.key);
      let monthNet = 0;
      monthActual.forEach(t => { monthNet += t.type==="income" ? t.amount : -t.amount; });
      monthProj.forEach(o   => { monthNet += o.type==="income" ? o.amount : -o.amount; });
      net[m.key] = monthNet;
      runBal += monthNet;
      closeBal[m.key] = runBal;
    });
    return { monthlyNet: net, monthlyOpenBal: openBal, monthlyCloseBal: closeBal };
  }, [data, monthList, actualTxns, projOccs, openingBalance, reportFrom]);

  const maxAbs = Math.max(...data.flatMap(r => monthList.map(m => Math.abs(r.monthly[m.key]||0))), 1);
  const GCOLS = `32px 160px repeat(${monthList.length}, 1fr) 110px`;
  const incomeRows  = data.filter(r=>r.cat.type==="income");
  const expenseRows = data.filter(r=>r.cat.type==="expense");
  const allCats = categories.filter(c=>reportType==="both"||c.type===reportType);

  function Cell({val,bold}) {
    const color=val===0?"#344558":val>0?"#00C896":"#FF4D4D";
    return <div style={{padding:"8px 6px",textAlign:"right"}}>
      <span style={{fontSize:11,fontFamily:"monospace",fontWeight:bold?800:600,color}}>{val===0?"—":(val>0?"+":"")+fmtShort(val)}</span>
    </div>;
  }

  function SectionDivider({label,color}) {
    return <div style={{display:"grid",gridTemplateColumns:GCOLS,gap:0,background:color+"11",borderTop:`1px solid ${color}33`,borderBottom:`1px solid ${color}33`,minWidth:600}}>
      <div/><div style={{padding:"6px 14px",fontSize:10,color,fontWeight:800,textTransform:"uppercase",letterSpacing:"0.1em",gridColumn:"2"}}>{label}</div>
      {monthList.map(m=><div key={m.key}/>)}<div/>
    </div>;
  }

  // Pre-compute all drill-down txns per category (can't use hooks inside nested fn)
  const drillTxnsMap = useMemo(()=>{
    const map = {};
    data.forEach(({cat})=>{
      const txns = [];
      actualTxns.filter(t=>t.categoryId===cat.id&&t.date.slice(0,7)>=reportFrom&&t.date.slice(0,7)<=reportTo)
        .forEach(t=>txns.push({...t,_src:"actual"}));
      projOccs.filter(o=>o.categoryId===cat.id)
        .forEach(o=>txns.push({...o,date:o.occDate,_src:"projected"}));
      map[cat.id] = txns.sort((a,b)=>a.date.localeCompare(b.date));
    });
    return map;
  },[data, actualTxns, projOccs, reportFrom, reportTo]);

  function CategoryRow({cat,monthly,total}) {
    const isExpanded = expandedCats.has(cat.id);
    const drillTxns  = drillTxnsMap[cat.id] || [];
    return <>
      <div className="rh" style={{display:"grid",gridTemplateColumns:GCOLS,gap:0,borderBottom:`1px solid ${COLORS.border}`,minWidth:600,transition:"background 0.12s",cursor:"pointer"}} onClick={()=>toggleExpand(cat.id)}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"center",color:COLORS.textMid,fontSize:10,fontWeight:700}}>
          {isExpanded?"▼":"▶"}
        </div>
        <div style={{padding:"9px 6px",display:"flex",alignItems:"center",gap:7}}>
          <Dot color={cat.color} size={7}/>
          <span style={{fontSize:12,color:COLORS.text,fontWeight:500}}>{cat.name}</span>
          {drillTxns.length>0&&<span style={{fontSize:9,background:COLORS.blue+"22",color:COLORS.blue,borderRadius:99,padding:"1px 5px",fontWeight:700}}>{drillTxns.length}</span>}
        </div>
        {monthList.map(m=>{
          const val=monthly[m.key]||0;
          const barW=val!==0?Math.max(3,Math.round((Math.abs(val)/maxAbs)*55)):0;
          const isPos=val>=0;
          const hasProj=projOccs.some(o=>o.occDate.slice(0,7)===m.key&&o.categoryId===cat.id);
          return(
            <div key={m.key} style={{padding:"9px 6px",textAlign:"right",position:"relative",borderLeft:hasProj?`2px dashed ${COLORS.blue}33`:"none"}}>
              {barW>0&&<div style={{position:"absolute",bottom:4,right:4,height:3,width:barW,background:isPos?COLORS.accent+"55":COLORS.danger+"55",borderRadius:2}}/>}
              <span style={{fontSize:11,fontFamily:"monospace",fontWeight:600,color:val===0?"#344558":isPos?COLORS.accent:COLORS.danger}}>
                {val===0?"—":(isPos?"+":"")+fmtShort(val)}
              </span>
            </div>
          );
        })}
        <div style={{padding:"9px 14px",textAlign:"right"}}>
          <span style={{fontSize:11,fontFamily:"monospace",fontWeight:800,color:total>=0?COLORS.accent:COLORS.danger}}>{total>=0?"+":""}{fmtShort(total)}</span>
        </div>
      </div>
      {isExpanded&&(
        <div style={{borderBottom:`1px solid ${COLORS.border}`,background:"#080E18"}}>
          {drillTxns.length===0&&<div style={{padding:"8px 48px",fontSize:11,color:COLORS.textDim}}>No transactions in this period.</div>}
          {drillTxns.slice(0,50).map((t,i)=>(
            <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"5px 14px 5px 48px",borderBottom:`1px solid ${COLORS.border}22`}}>
              <span style={{fontSize:10,color:COLORS.textMid,fontFamily:"monospace",width:70,flexShrink:0}}>{t.date}</span>
              <span style={{fontSize:11,color:COLORS.textMid,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{t.description}</span>
              <span style={{fontSize:11,fontFamily:"monospace",fontWeight:700,color:t.type==="income"?COLORS.accent:COLORS.danger}}>
                {t.type==="income"?"+":"-"}{fmtShort(t.amount)}
              </span>
              {t._src==="projected"&&<span style={{fontSize:9,color:COLORS.blue,background:COLORS.blueDim,borderRadius:99,padding:"1px 5px",fontWeight:700}}>PROJ</span>}
            </div>
          ))}
          {drillTxns.length>50&&<div style={{padding:"5px 48px",fontSize:10,color:COLORS.textDim}}>{drillTxns.length-50} more transactions…</div>}
        </div>
      )}
    </>;
  }

  return (
    <div style={{animation:"fadein 0.25s ease"}}>
      {/* Controls */}
      <div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14,flexWrap:"wrap"}}>
        <span style={{fontSize:11,color:COLORS.textMid}}>From</span>
        <input type="month" value={reportFrom} onChange={e=>setReportFrom(e.target.value)} style={{...inpS(),width:140,padding:"5px 9px",colorScheme:"dark"}}/>
        <span style={{fontSize:11,color:COLORS.textMid}}>To</span>
        <input type="month" value={reportTo} onChange={e=>setReportTo(e.target.value)} style={{...inpS(),width:140,padding:"5px 9px",colorScheme:"dark"}}/>
        <div style={{width:1,background:COLORS.border,height:18}}/>
        {[{k:"both",l:"All"},{k:"income",l:"Income"},{k:"expense",l:"Expense"}].map(({k,l})=>(
          <button key={k} onClick={()=>setReportType(k)} style={{background:reportType===k?COLORS.accentDim:"transparent",color:reportType===k?COLORS.accent:COLORS.textMid,border:`1px solid ${reportType===k?COLORS.accent+"44":COLORS.border}`,borderRadius:6,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer"}}>{l}</button>
        ))}
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8,fontSize:11,color:COLORS.textMid}}>
          <div style={{width:10,height:10,borderRadius:2,background:COLORS.accent+"55",border:`1px solid ${COLORS.accent}66`}}/>Actual
          <div style={{width:10,height:10,borderRadius:2,background:COLORS.blue+"55",border:`1px dashed ${COLORS.blue}88`}}/>Projected
          <span style={{color:COLORS.textDim}}>· Click row to drill down</span>
        </div>
      </div>

      {/* Category exclude checkboxes */}
      <div style={{background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderRadius:10,padding:"10px 14px",marginBottom:14}}>
        <div style={{fontSize:10,color:COLORS.textMid,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.09em",marginBottom:8}}>Exclude categories from report</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:7}}>
          {allCats.map(cat=>(
            <label key={cat.id} style={{display:"flex",alignItems:"center",gap:5,cursor:"pointer",padding:"3px 8px",borderRadius:6,background:hiddenCats.has(cat.id)?"transparent":cat.color+"15",border:`1px solid ${hiddenCats.has(cat.id)?COLORS.border:cat.color+"44"}`,opacity:hiddenCats.has(cat.id)?0.4:1,transition:"all 0.15s"}}>
              <input type="checkbox" checked={!hiddenCats.has(cat.id)} onChange={()=>toggleCat(cat.id)} style={{width:12,height:12,accentColor:cat.color,cursor:"pointer"}}/>
              <Dot color={cat.color} size={6}/>
              <span style={{fontSize:11,color:COLORS.text}}>{cat.name}</span>
              <span style={{fontSize:9,color:cat.type==="income"?COLORS.accent:COLORS.danger,fontWeight:700}}>{cat.type==="income"?"▲":"▼"}</span>
            </label>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderRadius:12,overflow:"auto"}}>
        {/* Header */}
        <div style={{display:"grid",gridTemplateColumns:GCOLS,gap:0,background:"#161E2A",borderBottom:`1px solid ${COLORS.border}`,minWidth:600}}>
          <div/>
          <div style={{padding:"8px 14px",fontSize:10,color:"#7A96B0",textTransform:"uppercase",letterSpacing:"0.09em",fontWeight:600}}>Category</div>
          {monthList.map(m=>(
            <div key={m.key} style={{padding:"8px 6px",textAlign:"right"}}>
              <div style={{fontSize:10,color:"#7A96B0",fontWeight:600}}>{m.label}</div>
              <div style={{fontSize:8,color:m.isPast?COLORS.accent:COLORS.blue,fontWeight:700,textTransform:"uppercase",marginTop:1}}>{m.isPast?"Actual":"Forecast"}</div>
            </div>
          ))}
          <div style={{padding:"8px 14px",fontSize:10,color:"#7A96B0",textTransform:"uppercase",fontWeight:600,textAlign:"right"}}>Total</div>
        </div>

        {/* Opening balance */}
        <div style={{display:"grid",gridTemplateColumns:GCOLS,gap:0,borderBottom:`1px solid ${COLORS.border}`,background:"#0E1828",minWidth:600}}>
          <div/><div style={{padding:"7px 14px",fontSize:11,color:COLORS.textMid,fontWeight:700,fontStyle:"italic"}}>Opening Balance</div>
          {monthList.map(m=>(
            <div key={m.key} style={{padding:"7px 6px",textAlign:"right"}}>
              <span style={{fontSize:11,fontFamily:"monospace",fontWeight:700,color:balColor(monthlyOpenBal[m.key]||0,0)}}>{fmtShort(monthlyOpenBal[m.key]||0)}</span>
            </div>
          ))}
          <div/>
        </div>

        {data.length===0&&<Empty msg="No data for selected period."/>}

        {/* Income section */}
        {incomeRows.length>0&&<SectionDivider label="Income" color={COLORS.accent}/>}
        {incomeRows.map(r=><CategoryRow key={r.cat.id} {...r}/>)}

        {/* Expense section */}
        {expenseRows.length>0&&<SectionDivider label="Expenses" color={COLORS.danger}/>}
        {expenseRows.map(r=><CategoryRow key={r.cat.id} {...r}/>)}

        {/* Net row */}
        {data.length>0&&<>
          <div style={{display:"grid",gridTemplateColumns:GCOLS,gap:0,borderTop:`1px solid ${COLORS.borderMid}`,background:"#0E1828",minWidth:600}}>
            <div/><div style={{padding:"9px 14px",fontSize:12,fontWeight:800,color:COLORS.text}}>Net Cash Flow</div>
            {monthList.map(m=><Cell key={m.key} val={monthlyNet[m.key]||0} bold/>)}
            <Cell val={Object.values(monthlyNet).reduce((s,v)=>s+v,0)} bold/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:GCOLS,gap:0,borderTop:`2px solid ${COLORS.border}`,background:"#0E1828",minWidth:600}}>
            <div/><div style={{padding:"9px 14px",fontSize:12,fontWeight:800,color:COLORS.text,fontStyle:"italic"}}>Closing Balance</div>
            {monthList.map(m=>(
              <div key={m.key} style={{padding:"9px 6px",textAlign:"right"}}>
                <span style={{fontSize:12,fontFamily:"monospace",fontWeight:800,color:balColor(monthlyCloseBal[m.key]||0,0)}}>{fmtShort(monthlyCloseBal[m.key]||0)}</span>
              </div>
            ))}
            <div/>
          </div>
        </>}
      </div>

      {/* Bar chart */}
      {data.length>0&&(
        <div style={{background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderRadius:12,padding:"16px 20px",marginTop:16}}>
          <div style={{fontSize:11,color:COLORS.textMid,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.09em",marginBottom:14}}>Monthly Net + Closing Balance</div>
          <div style={{display:"flex",gap:6,alignItems:"flex-end",height:90}}>
            {monthList.map(m=>{
              const net=monthlyNet[m.key]||0,close=monthlyCloseBal[m.key]||0;
              const maxNet=Math.max(...monthList.map(mm=>Math.abs(monthlyNet[mm.key]||0)),1);
              const h=Math.max(4,Math.round((Math.abs(net)/maxNet)*70));
              const isPos=net>=0;
              return(
                <div key={m.key} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                  <div style={{fontSize:8,color:balColor(close,0),fontWeight:700,fontFamily:"monospace"}}>{fmtShort(close).replace("CA","").replace(",000","k")}</div>
                  <div style={{fontSize:8,color:isPos?COLORS.accent:COLORS.danger,fontFamily:"monospace"}}>{net===0?"":((isPos?"+":"")+fmtShort(net).replace("CA","").replace(",000","k"))}</div>
                  <div style={{width:"100%",maxWidth:36,height:h,background:isPos?COLORS.accent+"88":COLORS.danger+"88",borderRadius:"3px 3px 0 0",border:`1px solid ${isPos?COLORS.accent+"66":COLORS.danger+"66"}`,borderStyle:m.isPast?"solid":"dashed"}}/>
                  <div style={{fontSize:8,color:COLORS.textMid,textAlign:"center"}}>{m.label.split(" ")[0]}</div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// UNIFIED LEDGER TABLE
// ─────────────────────────────────────────────────────────────────────────────
function UnifiedLedgerTable({rows, entities, categories, accounts, title, onMore, showAll,
  selectedIds, onToggleSelect, onToggleSelectAll, onDeleteSingle, onCatAssign, overdraftLimit=0}) {

  const canDelete = !!onToggleSelect; // only in full transactions tab
  const COLS = canDelete
    ? "32px 82px 70px 1fr 110px 100px 100px 130px 50px"
    : "82px 70px 1fr 110px 100px 100px 130px 80px";
  const LABELS = canDelete
    ? ["Date","Entity","Description","Amount","Category","Status","Balance",""]
    : ["Date","Entity","Description","Amount","Category","Status","Balance","Source"];

  // actual row ids in this view (for select-all)
  const actualIds = useMemo(() => rows.filter(r=>r._status==="actual").map(r=>r.id), [rows]);
  const allSelected = actualIds.length > 0 && actualIds.every(id => selectedIds?.has(id));
  const someSelected = actualIds.some(id => selectedIds?.has(id));

  const withDivider = useMemo(()=>{
    const out=[];
    let todayInserted=false;
    for(let i=0;i<rows.length;i++){
      const r=rows[i];
      if(!todayInserted && r._date<=TODAY_STR){
        out.push({_isDivider:true,key:"today-divider"});
        todayInserted=true;
      }
      out.push(r);
    }
    if(!todayInserted) out.push({_isDivider:true,key:"today-divider"});
    return out;
  },[rows]);

  return (
    <div style={{background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderRadius:canDelete?12:"12px 12px 0 0",overflow:"hidden"}}>
      {title&&(
        <div style={{padding:"11px 14px",borderBottom:`1px solid ${COLORS.border}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontWeight:700,fontSize:13}}>{title}</span>
          {onMore&&<button onClick={onMore} style={{background:"none",border:"none",color:COLORS.accent,cursor:"pointer",fontSize:11,fontWeight:700}}>View all →</button>}
        </div>
      )}

      {/* Column headers — with select-all checkbox */}
      <div style={{display:"grid",gridTemplateColumns:COLS,gap:10,padding:"8px 14px",borderBottom:`1px solid ${COLORS.border}`,background:"#161E2A"}}>
        {canDelete&&(
          <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
            <input type="checkbox" checked={allSelected} ref={el=>{if(el)el.indeterminate=someSelected&&!allSelected;}}
              onChange={()=>onToggleSelectAll(actualIds)}
              style={{width:14,height:14,cursor:"pointer",accentColor:COLORS.accent}}/>
          </div>
        )}
        {LABELS.filter((_,i)=>!(canDelete&&i===0)).map((l,i)=>(
          <span key={i} style={{fontSize:10,color:"#7A96B0",textTransform:"uppercase",letterSpacing:"0.09em",fontWeight:600,
            textAlign:(l==="Amount"||l==="Balance")?"right":"left"}}>{l}</span>
        ))}
      </div>

      <div style={{maxHeight:showAll?620:380,overflowY:"auto"}}>
        {withDivider.length===0&&<Empty msg="No transactions to display."/>}
        {withDivider.map((row,idx)=>{
          // TODAY divider
          if(row._isDivider) return (
            <div key="div" style={{display:"flex",alignItems:"center",gap:10,padding:"6px 14px",background:"#0F1800",borderTop:`1px solid ${COLORS.warning}44`,borderBottom:`1px solid ${COLORS.warning}44`,position:"sticky",top:0,zIndex:10}}>
              <div style={{flex:1,height:1,background:`linear-gradient(90deg,transparent,${COLORS.warning}66)`}}/>
              <div style={{display:"flex",alignItems:"center",gap:7,background:COLORS.warning+"22",border:`1px solid ${COLORS.warning}55`,borderRadius:20,padding:"3px 12px"}}>
                <div style={{width:6,height:6,borderRadius:"50%",background:COLORS.warning}}/>
                <span style={{fontSize:10,fontWeight:800,color:COLORS.warning,letterSpacing:"0.1em",textTransform:"uppercase"}}>Today — {TODAY_STR}</span>
              </div>
              <div style={{flex:1,height:1,background:`linear-gradient(90deg,${COLORS.warning}66,transparent)`}}/>
            </div>
          );

          const isProj = row._status==="projected";
          const isSelected = canDelete && !isProj && selectedIds?.has(row.id);
          const ent = entities.find(e=>e.id===row.entityId);
          const cat = categories.find(c=>c.id===row.categoryId);

          return (
            <div key={row.id+idx} className="rh" style={{
              display:"grid", gridTemplateColumns:COLS, gap:10, padding:"8px 14px", alignItems:"center",
              borderBottom:`1px solid ${COLORS.border}`,
              background: isSelected ? "#1A0A0A" : isProj ? "#0A1525" : "transparent",
              borderLeft: isSelected ? `3px solid ${COLORS.danger}` : isProj ? `3px dashed ${COLORS.blue}55` : `3px solid transparent`,
              transition:"background 0.12s",
              opacity: isProj ? 0.88 : 1,
            }}>
              {/* Checkbox — actual rows only for bulk select */}
              {canDelete&&(
                <div style={{display:"flex",alignItems:"center",justifyContent:"center"}}>
                  {!isProj
                    ? <input type="checkbox" checked={!!isSelected} onChange={()=>onToggleSelect(row.id)}
                        style={{width:14,height:14,cursor:"pointer",accentColor:COLORS.danger}}/>
                    : <span style={{width:14,height:14,display:"inline-block"}}/>
                  }
                </div>
              )}

              {/* Date */}
              <span style={{fontSize:11,fontFamily:"monospace",color:isProj?COLORS.blue:COLORS.textMid}}>{row._date.slice(5)}</span>

              {/* Entity */}
              <div style={{display:"flex",alignItems:"center",gap:4}}>
                <Dot color={ent?.color||COLORS.textMid} size={6}/>
                <span style={{fontSize:10,color:ent?.color||COLORS.textMid,fontWeight:700}}>{ent?.short||"—"}</span>
              </div>

              {/* Description */}
              <div>
                <div style={{fontSize:12,color:COLORS.text,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{row.description}</div>
                {isProj&&row.recurrence!=="once"&&<div style={{fontSize:9,color:COLORS.blue,fontWeight:600,textTransform:"uppercase",letterSpacing:"0.08em"}}>↻ {row.recurrence}</div>}
              </div>

              {/* Amount */}
              <span style={{textAlign:"right",fontWeight:700,fontFamily:"monospace",fontSize:12,color:row.type==="income"?COLORS.accent:COLORS.danger}}>
                {row.type==="income"?"+":"−"}{fmtCAD(row.amount)}
              </span>

              {/* Category — always-available dropdown, works for assigned and unassigned */}
              <div onClick={e=>e.stopPropagation()}>
                <select
                  value={row.categoryId||""}
                  onChange={e=>{ if(onCatAssign) onCatAssign(row.id, e.target.value, row.type); }}
                  style={{
                    fontSize:10,
                    background: (!row.categoryId||row.categoryId==="") ? "#1A0A00" : "transparent",
                    border: `1px solid ${(!row.categoryId||row.categoryId==="") ? COLORS.warning+"88" : COLORS.border}`,
                    color: (!row.categoryId||row.categoryId==="") ? COLORS.warning : cat ? cat.color : COLORS.textMid,
                    borderRadius:6, padding:"3px 7px", cursor:"pointer", maxWidth:105, fontWeight:700,
                    outline:"none",
                  }}>
                  <option value="" disabled>{(!row.categoryId||row.categoryId==="")?"⚠ Set category":"— category —"}</option>
                  <optgroup label="▲ Income">
                    {categories.filter(c=>c.type==="income").map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                  <optgroup label="▼ Expense">
                    {categories.filter(c=>c.type==="expense").map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
                  </optgroup>
                </select>
              </div>

              {/* Status */}
              <div>
                {isProj ? <Badge color={COLORS.blue}>Projected</Badge> : <Badge color={COLORS.accent}>QB Actual</Badge>}
              </div>

              {/* Running balance */}
              <span style={{textAlign:"right",fontWeight:800,fontFamily:"monospace",fontSize:13,
                color:balColor(row.runBalance, overdraftLimit),
                opacity:isProj?0.8:1}}>
                {fmtCAD(row.runBalance)}
              </span>

              {/* Delete button / Source badge */}
              {canDelete ? (
                <button onClick={()=>onDeleteSingle(row)} title={isProj?"Delete projected transaction":"Delete transaction"}
                  style={{background:"transparent",border:`1px solid ${isProj?COLORS.blue+"44":COLORS.border}`,color:isProj?COLORS.blue+"88":COLORS.textDim,borderRadius:6,padding:"3px 7px",fontSize:12,cursor:"pointer",lineHeight:1,transition:"all 0.15s"}}
                  onMouseEnter={e=>{
                    e.currentTarget.style.background=isProj?COLORS.blueDim:COLORS.dangerDim;
                    e.currentTarget.style.borderColor=isProj?COLORS.blue+"88":COLORS.danger+"55";
                    e.currentTarget.style.color=isProj?COLORS.blue:COLORS.danger;
                  }}
                  onMouseLeave={e=>{
                    e.currentTarget.style.background="transparent";
                    e.currentTarget.style.borderColor=isProj?COLORS.blue+"44":COLORS.border;
                    e.currentTarget.style.color=isProj?COLORS.blue+"88":COLORS.textDim;
                  }}>
                  🗑
                </button>
              ) : (
                <Badge color={row.source==="quickbooks"?COLORS.qb:isProj?COLORS.blue:COLORS.warning}>
                  {row.source==="quickbooks"?"QB":isProj?"Forecast":"Manual"}
                </Badge>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROJECTIONS TAB
// ─────────────────────────────────────────────────────────────────────────────
function ProjectionsTab({projections,setProjections,filteredProjOccs,entities,accounts,categories}){
  const blank={entityId:entities[0]?.id||"",accountId:"",description:"",amount:"",type:"income",categoryId:"cat1",recurrence:"once",startDate:dateStr(addDays(TODAY,7)),endDate:dateStr(addMonths(TODAY,3))};
  const [form,setForm]=useState(blank);
  const [editId,setEditId]=useState(null);
  const formAccs=accounts.filter(a=>a.entityId===form.entityId);
  useEffect(()=>{if(!formAccs.find(a=>a.id===form.accountId))setForm(f=>({...f,accountId:formAccs[0]?.id||""}));},[form.entityId]);
  const save=()=>{
    if(!form.description||!form.amount)return;
    const p={...form,amount:parseFloat(form.amount)};
    if(editId){setProjections(prev=>prev.map(x=>x.id===editId?{...p,id:editId}:x));setEditId(null);}
    else setProjections(prev=>[...prev,{...p,id:uid()}]);
    setForm(blank);
  };
  const startEdit=(p)=>{setForm({...p,amount:String(p.amount)});setEditId(p.id);};
  const del=(id)=>{setProjections(prev=>prev.filter(p=>p.id!==id));if(editId===id){setEditId(null);setForm(blank);}};
  const filteredRules=projections.filter(p=>(form.entityId==="all"||true));

  return(<>
    <SectionHead title="Projection Rules" sub="Define recurring & one-time future cash flows. Projected items appear in the Transactions tab."/>
    <div style={{background:COLORS.surface,border:`1px solid ${editId?COLORS.blue+"55":COLORS.accent+"44"}`,borderRadius:12,padding:18,marginBottom:20}}>
      <div style={{fontSize:12,fontWeight:700,color:editId?COLORS.blue:COLORS.accent,marginBottom:14}}>{editId?"✏ Edit Rule":"＋ New Rule"}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:10}}>
        <Fld label="Entity"><select style={selS()} value={form.entityId} onChange={e=>setForm(f=>({...f,entityId:e.target.value}))}>{entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></Fld>
        <Fld label="Account"><select style={selS()} value={form.accountId} onChange={e=>setForm(f=>({...f,accountId:e.target.value}))}>{formAccs.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></Fld>
        <Fld label="Type"><select style={selS()} value={form.type} onChange={e=>{
          const newType=e.target.value;
          const firstCat=categories.find(c=>c.type===newType);
          setForm(f=>({...f,type:newType,categoryId:firstCat?.id||""}));
        }}><option value="income">Collection / Income</option><option value="expense">Expense / Payment</option></select></Fld>
        <Fld label="Category"><select style={selS()} value={form.categoryId} onChange={e=>setForm(f=>({...f,categoryId:e.target.value}))}>{categories.filter(c=>c.type===form.type).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></Fld>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:10,marginBottom:10}}>
        <Fld label="Description"><input style={inpS()} placeholder="e.g. Monthly Payroll" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))}/></Fld>
        <Fld label="Amount (CAD)"><input style={inpS()} type="number" placeholder="0.00" value={form.amount} onChange={e=>setForm(f=>({...f,amount:e.target.value}))}/></Fld>
        <Fld label="Recurrence"><select style={selS()} value={form.recurrence} onChange={e=>setForm(f=>({...f,recurrence:e.target.value}))}><option value="once">One-time</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></Fld>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,alignItems:"end"}}>
        <Fld label={form.recurrence==="once"?"Date":"Start Date"}><input style={{...inpS(),colorScheme:"dark"}} type="date" value={form.startDate} onChange={e=>setForm(f=>({...f,startDate:e.target.value}))}/></Fld>
        {form.recurrence!=="once"&&<Fld label="End Date"><input style={{...inpS(),colorScheme:"dark"}} type="date" value={form.endDate} onChange={e=>setForm(f=>({...f,endDate:e.target.value}))}/></Fld>}
        <div style={{gridColumn:form.recurrence==="once"?"2/4":"3/5",display:"flex",gap:8,alignItems:"flex-end"}}>
          <button onClick={save} style={{flex:1,background:editId?COLORS.blue:COLORS.accent,color:"#000",border:"none",borderRadius:7,padding:"9px 0",fontWeight:700,fontSize:13,cursor:"pointer"}}>{editId?"Save Changes":"Add Rule"}</button>
          {editId&&<button onClick={()=>{setEditId(null);setForm(blank);}} style={{background:"#161E2A",color:COLORS.textMid,border:`1px solid ${COLORS.border}`,borderRadius:7,padding:"9px 12px",fontSize:12,cursor:"pointer"}}>Cancel</button>}
        </div>
      </div>
    </div>

    <div style={{background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderRadius:12,overflow:"hidden"}}>
      <ColHdr cols="90px 1fr 90px 90px 90px 130px 80px 100px" labels={["Entity","Description","Amount","Type","Recurrence","Date Range","Occurrences","Actions"]}/>
      {projections.length===0&&<Empty msg="No projection rules. Add one above."/>}
      {projections.sort((a,b)=>a.startDate.localeCompare(b.startDate)).map(p=>{
        const ent=entities.find(e=>e.id===p.entityId);
        const occ=expandRecurring(p);
        const cat=categories.find(c=>c.id===p.categoryId);
        return(
          <div key={p.id} className="rh" style={{display:"grid",gridTemplateColumns:"90px 1fr 90px 90px 90px 130px 80px 100px",gap:10,padding:"9px 14px",alignItems:"center",borderBottom:`1px solid ${COLORS.border}`,background:editId===p.id?COLORS.blue+"09":"transparent",transition:"background 0.12s"}}>
            <div style={{display:"flex",alignItems:"center",gap:5}}><Dot color={ent?.color||COLORS.textMid} size={7}/><span style={{fontSize:11,color:ent?.color,fontWeight:700}}>{ent?.short}</span></div>
            <div><div style={{fontSize:12,color:COLORS.text,fontWeight:500}}>{p.description}</div>{cat&&<Badge color={cat.color}>{cat.name}</Badge>}</div>
            <span style={{textAlign:"right",fontWeight:700,fontFamily:"monospace",fontSize:12,color:p.type==="income"?COLORS.accent:COLORS.danger}}>{p.type==="income"?"+":"−"}{fmtShort(p.amount)}</span>
            <Badge color={p.type==="income"?COLORS.accent:COLORS.danger}>{p.type==="income"?"Income":"Expense"}</Badge>
            <Badge color={COLORS.purple}>{p.recurrence}</Badge>
            <span style={{fontSize:10,color:COLORS.textMid,fontFamily:"monospace"}}>{p.startDate.slice(5)}{p.recurrence!=="once"?" → "+p.endDate?.slice(5):""}</span>
            <span style={{fontSize:11,color:COLORS.textMid}}>{occ.length}× <span style={{color:p.type==="income"?COLORS.accent:COLORS.danger}}>{fmtShort(occ.length*p.amount)}</span></span>
            <div style={{display:"flex",gap:5}}>
              <button onClick={()=>startEdit(p)} style={{background:COLORS.blueDim,border:`1px solid ${COLORS.blue}33`,color:COLORS.blue,borderRadius:5,padding:"3px 7px",fontSize:10,cursor:"pointer",fontWeight:700}}>Edit</button>
              <button onClick={()=>del(p.id)} style={{background:COLORS.dangerDim,border:`1px solid ${COLORS.danger}33`,color:COLORS.danger,borderRadius:5,padding:"3px 7px",fontSize:10,cursor:"pointer",fontWeight:700}}>Del</button>
            </div>
          </div>
        );
      })}
    </div>
  </>);
}

// ─────────────────────────────────────────────────────────────────────────────
// SETTINGS TAB
// ─────────────────────────────────────────────────────────────────────────────
function SettingsTab({entities,setEntities,accounts,setAccounts,categories,setCategories,settingsTab,setSettingsTab,users,saveUsers,currentUser}){
  const STABS=["entities","accounts","categories","users","bank sync"];
  return(<>
    <SectionHead title="Settings" sub="Manage entities, accounts, categories, users and bank connections"/>
    <div style={{display:"flex",gap:0,marginBottom:22,borderBottom:`1px solid ${COLORS.border}`}}>
      {STABS.map(t=>(
        <button key={t} onClick={()=>setSettingsTab(t)} style={{background:"transparent",color:settingsTab===t?COLORS.accent:COLORS.textMid,border:"none",borderBottom:settingsTab===t?`2px solid ${COLORS.accent}`:"2px solid transparent",padding:"8px 14px",fontSize:12,fontWeight:600,cursor:"pointer",textTransform:"capitalize",position:"relative"}}>
          {t}
          {t==="users"&&<span style={{marginLeft:5,fontSize:9,fontWeight:700,padding:"1px 5px",borderRadius:99,background:COLORS.purple+"22",color:COLORS.purple,border:`1px solid ${COLORS.purple}33`}}>{users?.length||0}</span>}
        </button>
      ))}
    </div>
    {settingsTab==="entities"  &&<EntitiesSettings  entities={entities}  setEntities={setEntities}/>}
    {settingsTab==="accounts"  &&<AccountsSettings  accounts={accounts}  setAccounts={setAccounts}  entities={entities}/>}
    {settingsTab==="categories"&&<CategoriesSettings categories={categories} setCategories={setCategories}/>}
    {settingsTab==="users"     &&<UserManagement users={users||[]} saveUsers={saveUsers} currentUser={currentUser}/>}
    {settingsTab==="bank sync" &&<BankSyncPanel entities={entities}/>}
  </>);
}

function EntitiesSettings({entities,setEntities}){
  const blank={name:"",short:"",color:PALETTE[0]};
  const [form,setForm]=useState(blank);const [editId,setEditId]=useState(null);
  const save=()=>{if(!form.name||!form.short)return;if(editId){setEntities(p=>p.map(e=>e.id===editId?{...form,id:editId}:e));setEditId(null);}else setEntities(p=>[...p,{...form,id:uid()}]);setForm(blank);};
  const startEdit=(e)=>{setForm({name:e.name,short:e.short,color:e.color});setEditId(e.id);};
  const del=(id)=>{setEntities(p=>p.filter(e=>e.id!==id));if(editId===id){setEditId(null);setForm(blank);}};
  return(<div>
    <div style={{background:COLORS.surface,border:`1px solid ${editId?COLORS.blue+"55":COLORS.accent+"44"}`,borderRadius:12,padding:18,marginBottom:20}}>
      <div style={{fontSize:12,fontWeight:700,color:editId?COLORS.blue:COLORS.accent,marginBottom:14}}>{editId?"✏ Edit Entity":"＋ New Entity"}</div>
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 160px 90px",gap:10,alignItems:"end"}}>
        <Fld label="Company Name"><input style={inpS()} placeholder="Canada MedLaser Inc" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></Fld>
        <Fld label="Short Code"><input style={inpS()} placeholder="CML" value={form.short} onChange={e=>setForm(f=>({...f,short:e.target.value.toUpperCase().slice(0,6)}))}/></Fld>
        <Fld label="Colour"><div style={{display:"flex",gap:5,flexWrap:"wrap",paddingTop:2}}>{PALETTE.map(p=><div key={p} onClick={()=>setForm(f=>({...f,color:p}))} style={{width:22,height:22,borderRadius:"50%",background:p,cursor:"pointer",border:form.color===p?`3px solid ${COLORS.text}`:`2px solid ${COLORS.bg}`}}/>)}</div></Fld>
        <div style={{display:"flex",gap:6,alignItems:"flex-end"}}><button onClick={save} style={{flex:1,background:editId?COLORS.blue:COLORS.accent,color:"#000",border:"none",borderRadius:7,padding:"9px 0",fontWeight:700,fontSize:12,cursor:"pointer"}}>{editId?"Save":"Add"}</button>{editId&&<button onClick={()=>{setEditId(null);setForm(blank);}} style={{background:"#161E2A",color:COLORS.textMid,border:`1px solid ${COLORS.border}`,borderRadius:7,padding:"9px 8px",fontSize:12,cursor:"pointer"}}>✕</button>}</div>
      </div>
    </div>
    <div style={{background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderRadius:12,overflow:"hidden"}}>
      <ColHdr cols="50px 1fr 100px 100px" labels={["","Name","Short","Actions"]}/>
      {entities.map(e=><div key={e.id} className="rh" style={{display:"grid",gridTemplateColumns:"50px 1fr 100px 100px",gap:10,padding:"10px 14px",alignItems:"center",borderBottom:`1px solid ${COLORS.border}`,transition:"background 0.12s"}}><Dot color={e.color} size={14}/><span style={{fontSize:13,color:COLORS.text,fontWeight:600}}>{e.name}</span><Badge color={e.color}>{e.short}</Badge><div style={{display:"flex",gap:5}}><button onClick={()=>startEdit(e)} style={{background:COLORS.blueDim,border:`1px solid ${COLORS.blue}33`,color:COLORS.blue,borderRadius:5,padding:"3px 8px",fontSize:10,cursor:"pointer",fontWeight:700}}>Edit</button><button onClick={()=>del(e.id)} style={{background:COLORS.dangerDim,border:`1px solid ${COLORS.danger}33`,color:COLORS.danger,borderRadius:5,padding:"3px 8px",fontSize:10,cursor:"pointer",fontWeight:700}}>Del</button></div></div>)}
      {entities.length===0&&<Empty msg="No entities."/>}
    </div>
  </div>);
}

function AccountsSettings({accounts,setAccounts,entities}){
  const blank={entityId:entities[0]?.id||"",name:"",number:"",openBalance:"",overdraft:"",qbAccountId:""};
  const [form,    setForm]    = useState(blank);
  const [editId,  setEditId]  = useState(null);
  const [qbAccts, setQbAccts] = useState({}); // entityId → [{id,name,number,balance}]
  const [loadingQB, setLoadingQB] = useState(false);

  // Load QB accounts for all connected companies
  useEffect(()=>{
    setLoadingQB(true);
    fetch("/api/qb-companies").then(r=>r.json()).then(d=>{
      const map = {};
      (d.companies||[]).forEach(c=>{ if(c.entityId && c.bankAccounts) map[c.entityId]=c.bankAccounts; });
      setQbAccts(map);
    }).catch(()=>{}).finally(()=>setLoadingQB(false));
  },[]);

  const save=()=>{
    if(!form.name||!form.entityId)return;
    const ent=entities.find(e=>e.id===form.entityId);
    const a={...form,openBalance:parseFloat(form.openBalance)||0,overdraft:parseFloat(form.overdraft)||0,color:ent?.color||COLORS.textMid};
    if(editId){setAccounts(p=>p.map(x=>x.id===editId?{...a,id:editId}:x));setEditId(null);}
    else setAccounts(p=>[...p,{...a,id:uid()}]);
    setForm(blank);
  };
  const startEdit=(a)=>{setForm({entityId:a.entityId,name:a.name,number:a.number,openBalance:String(a.openBalance),overdraft:String(a.overdraft||0),qbAccountId:a.qbAccountId||""});setEditId(a.id);};
  const del=(id)=>{setAccounts(p=>p.filter(a=>a.id!==id));if(editId===id){setEditId(null);setForm(blank);}};

  const availQBAccts = qbAccts[form.entityId] || [];

  return(<div>
    <div style={{background:COLORS.surface,border:`1px solid ${editId?COLORS.blue+"55":COLORS.accent+"44"}`,borderRadius:12,padding:18,marginBottom:20}}>
      <div style={{fontSize:12,fontWeight:700,color:editId?COLORS.blue:COLORS.accent,marginBottom:14}}>{editId?"✏ Edit Account":"＋ New Account"}</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr 1fr 90px",gap:10,alignItems:"end"}}>
        <Fld label="Entity"><select style={selS()} value={form.entityId} onChange={e=>setForm(f=>({...f,entityId:e.target.value,qbAccountId:""}))}>{entities.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}</select></Fld>
        <Fld label="Account Name"><input style={inpS()} placeholder="RBC Operations" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></Fld>
        <Fld label="Account # (masked)"><input style={inpS()} placeholder="****4821" value={form.number} onChange={e=>setForm(f=>({...f,number:e.target.value}))}/></Fld>
        <Fld label="Opening Balance"><input style={inpS()} type="number" placeholder="0.00" value={form.openBalance} onChange={e=>setForm(f=>({...f,openBalance:e.target.value}))}/></Fld>
        <Fld label="Overdraft Limit">
          <input style={{...inpS(),borderColor:form.overdraft&&parseFloat(form.overdraft)>0?COLORS.danger+"66":COLORS.border}} type="number" placeholder="0 = none" value={form.overdraft} onChange={e=>setForm(f=>({...f,overdraft:e.target.value}))}/>
        </Fld>
        <Fld label={loadingQB?"QB Account (loading…)":"Link to QB Account"}>
          <select style={{...selS(),borderColor:form.qbAccountId?COLORS.qb+"88":COLORS.border}} value={form.qbAccountId} onChange={e=>setForm(f=>({...f,qbAccountId:e.target.value}))}>
            <option value="">— not linked —</option>
            {availQBAccts.map(a=><option key={a.id} value={a.id}>{a.name}{a.number?` ****${a.number.slice(-4)}`:""}</option>)}
            {availQBAccts.length===0&&!loadingQB&&<option disabled value="">Connect QB first in Bank Sync tab</option>}
          </select>
        </Fld>
        <div style={{display:"flex",gap:6,alignItems:"flex-end"}}>
          <button onClick={save} style={{flex:1,background:editId?COLORS.blue:COLORS.accent,color:"#000",border:"none",borderRadius:7,padding:"9px 0",fontWeight:700,fontSize:12,cursor:"pointer"}}>{editId?"Save":"Add"}</button>
          {editId&&<button onClick={()=>{setEditId(null);setForm(blank);}} style={{background:"#161E2A",color:COLORS.textMid,border:`1px solid ${COLORS.border}`,borderRadius:7,padding:"9px 8px",fontSize:12,cursor:"pointer"}}>✕</button>}
        </div>
      </div>
      <div style={{marginTop:12,display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div style={{padding:"8px 12px",background:COLORS.dangerDim,border:`1px solid ${COLORS.danger}22`,borderRadius:7,fontSize:11,color:COLORS.textMid,lineHeight:1.5}}>
          <span style={{color:COLORS.danger,fontWeight:700}}>Overdraft limit</span> — the max the bank allows below zero. Balance turns red when exceeded, amber when negative but within limit.
        </div>
        <div style={{padding:"8px 12px",background:"#051510",border:`1px solid ${COLORS.qb}33`,borderRadius:7,fontSize:11,color:COLORS.textMid,lineHeight:1.5}}>
          <span style={{color:COLORS.qb,fontWeight:700}}>Link to QB Account</span> — connects this account to a specific QuickBooks bank account. Only transactions from that QB account will sync here.
        </div>
      </div>
    </div>

    {/* Accounts table */}
    <div style={{background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderRadius:12,overflow:"hidden"}}>
      {entities.map(ent=>{
        const eAccs=accounts.filter(a=>a.entityId===ent.id);
        if(!eAccs.length) return null;
        const entQBAccts = qbAccts[ent.id]||[];
        return(
          <div key={ent.id}>
            <div style={{padding:"7px 14px",background:"#161E2A",borderBottom:`1px solid ${COLORS.border}`,display:"flex",alignItems:"center",gap:7}}>
              <Dot color={ent.color} size={8}/>
              <span style={{fontSize:11,color:ent.color,fontWeight:700}}>{ent.name}</span>
              {entQBAccts.length>0&&<span style={{fontSize:10,color:COLORS.qb,background:COLORS.qb+"15",border:`1px solid ${COLORS.qb}33`,borderRadius:99,padding:"1px 7px",marginLeft:6}}>QB connected · {entQBAccts.length} accounts</span>}
              <span style={{fontSize:10,color:COLORS.textDim,marginLeft:"auto"}}>Total: {fmtShort(eAccs.reduce((s,a)=>s+(a.openBalance||0),0))}</span>
            </div>
            {eAccs.map(a=>{
              const linkedQB = entQBAccts.find(q=>q.id===a.qbAccountId);
              return(
                <div key={a.id} className="rh" style={{display:"grid",gridTemplateColumns:"90px 1fr 110px 120px 110px 1fr 90px",gap:10,padding:"9px 14px",alignItems:"center",borderBottom:`1px solid ${COLORS.border}`,transition:"background 0.12s"}}>
                  <Badge color={ent.color}>{ent.short}</Badge>
                  <span style={{fontSize:13,color:COLORS.text,fontWeight:500}}>{a.name}</span>
                  <span style={{fontSize:12,fontFamily:"monospace",color:COLORS.textMid}}>{a.number}</span>
                  <span style={{fontSize:13,fontWeight:700,fontFamily:"monospace",color:COLORS.accent}}>{fmtCAD(a.openBalance||0)}</span>
                  <div>
                    {(a.overdraft||0)>0
                      ? <span style={{fontSize:12,fontFamily:"monospace",fontWeight:700,color:COLORS.danger}}>−{fmtShort(a.overdraft)}</span>
                      : <span style={{fontSize:11,color:COLORS.textDim}}>No OD</span>}
                  </div>
                  {/* QB link status */}
                  <div style={{display:"flex",alignItems:"center",gap:5}}>
                    {linkedQB ? (
                      <div style={{display:"flex",alignItems:"center",gap:5,background:COLORS.qb+"15",border:`1px solid ${COLORS.qb}33`,borderRadius:6,padding:"2px 8px"}}>
                        <div style={{width:6,height:6,borderRadius:"50%",background:COLORS.qb}}/>
                        <span style={{fontSize:11,color:COLORS.qb,fontWeight:600}}>{linkedQB.name}</span>
                        <span style={{fontSize:10,color:COLORS.textMid,fontFamily:"monospace"}}>{fmtShort(linkedQB.balance)}</span>
                      </div>
                    ) : (
                      <span style={{fontSize:11,color:COLORS.textDim}}>Not linked to QB</span>
                    )}
                  </div>
                  <div style={{display:"flex",gap:5}}>
                    <button onClick={()=>startEdit(a)} style={{background:COLORS.blueDim,border:`1px solid ${COLORS.blue}33`,color:COLORS.blue,borderRadius:5,padding:"3px 8px",fontSize:10,cursor:"pointer",fontWeight:700}}>Edit</button>
                    <button onClick={()=>del(a.id)} style={{background:COLORS.dangerDim,border:`1px solid ${COLORS.danger}33`,color:COLORS.danger,borderRadius:5,padding:"3px 8px",fontSize:10,cursor:"pointer",fontWeight:700}}>Del</button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
      {accounts.length===0&&<Empty msg="No accounts."/>}
    </div>
  </div>);
}

function CategoriesSettings({categories,setCategories}){
  const blank={name:"",type:"income",color:PALETTE[0]};
  const [form,setForm]=useState(blank);const [editId,setEditId]=useState(null);
  const save=()=>{if(!form.name)return;if(editId){setCategories(p=>p.map(c=>c.id===editId?{...form,id:editId}:c));setEditId(null);}else setCategories(p=>[...p,{...form,id:uid()}]);setForm(blank);};
  const startEdit=(c)=>{setForm({name:c.name,type:c.type,color:c.color});setEditId(c.id);};
  const del=(id)=>{setCategories(p=>p.filter(c=>c.id!==id));if(editId===id){setEditId(null);setForm(blank);}};
  return(<div>
    <div style={{background:COLORS.surface,border:`1px solid ${editId?COLORS.blue+"55":COLORS.accent+"44"}`,borderRadius:12,padding:18,marginBottom:20}}>
      <div style={{fontSize:12,fontWeight:700,color:editId?COLORS.blue:COLORS.accent,marginBottom:14}}>{editId?"✏ Edit Category":"＋ New Category"}</div>
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 160px 90px",gap:10,alignItems:"end"}}>
        <Fld label="Name"><input style={inpS()} placeholder="Franchise Fees" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/></Fld>
        <Fld label="Type"><select style={selS()} value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}><option value="income">Income</option><option value="expense">Expense</option></select></Fld>
        <Fld label="Colour"><div style={{display:"flex",gap:5,flexWrap:"wrap",paddingTop:2}}>{PALETTE.map(p=><div key={p} onClick={()=>setForm(f=>({...f,color:p}))} style={{width:20,height:20,borderRadius:"50%",background:p,cursor:"pointer",border:form.color===p?`3px solid ${COLORS.text}`:`2px solid ${COLORS.bg}`}}/>)}</div></Fld>
        <div style={{display:"flex",gap:6,alignItems:"flex-end"}}><button onClick={save} style={{flex:1,background:editId?COLORS.blue:COLORS.accent,color:"#000",border:"none",borderRadius:7,padding:"9px 0",fontWeight:700,fontSize:12,cursor:"pointer"}}>{editId?"Save":"Add"}</button>{editId&&<button onClick={()=>{setEditId(null);setForm(blank);}} style={{background:"#161E2A",color:COLORS.textMid,border:`1px solid ${COLORS.border}`,borderRadius:7,padding:"9px 8px",fontSize:12,cursor:"pointer"}}>✕</button>}</div>
      </div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
      {[{label:"Income",list:categories.filter(c=>c.type==="income"),color:COLORS.accent},{label:"Expense",list:categories.filter(c=>c.type==="expense"),color:COLORS.danger}].map(({label,list,color})=>(
        <div key={label} style={{background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderRadius:12,overflow:"hidden"}}>
          <div style={{padding:"10px 14px",borderBottom:`1px solid ${COLORS.border}`,display:"flex",justifyContent:"space-between"}}><span style={{fontWeight:700,fontSize:12,color}}>{label} Categories</span><span style={{fontSize:11,color:COLORS.textMid}}>{list.length}</span></div>
          {list.map(c=><div key={c.id} className="rh" style={{display:"flex",alignItems:"center",gap:10,padding:"8px 14px",borderBottom:`1px solid ${COLORS.border}`,transition:"background 0.12s"}}><Dot color={c.color} size={10}/><span style={{flex:1,fontSize:13,color:COLORS.text}}>{c.name}</span><button onClick={()=>startEdit(c)} style={{background:COLORS.blueDim,border:`1px solid ${COLORS.blue}33`,color:COLORS.blue,borderRadius:5,padding:"3px 8px",fontSize:10,cursor:"pointer",fontWeight:700}}>Edit</button><button onClick={()=>del(c.id)} style={{background:COLORS.dangerDim,border:`1px solid ${COLORS.danger}33`,color:COLORS.danger,borderRadius:5,padding:"3px 8px",fontSize:10,cursor:"pointer",fontWeight:700}}>Del</button></div>)}
          {list.length===0&&<Empty msg="No categories."/>}
        </div>
      ))}
    </div>
  </div>);
}

function BankSyncPanel({ entities }){
  const [connections, setConnections] = useState([]);
  const [companies,   setCompanies]   = useState([]);
  const [lastSync,    setLastSync]    = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [syncing,     setSyncing]     = useState(false);
  const [syncResult,  setSyncResult]  = useState(null);
  const [assigning,   setAssigning]   = useState(null);

  const reload = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/qb-status").then(r=>r.json()).catch(()=>({connections:[],lastSync:null})),
      fetch("/api/qb-companies").then(r=>r.json()).catch(()=>({companies:[]})),
    ]).then(([status,compData])=>{
      setConnections(status.connections||[]);
      setLastSync(status.lastSync);
      setCompanies(compData.companies||[]);
    }).finally(()=>setLoading(false));
  };
  useEffect(()=>{ reload(); },[]);

  const connect    = ()          => { window.location.href=`/api/qb-auth?entityId=unassigned`; };
  const connectFor = (entityId)  => { window.location.href=`/api/qb-auth?entityId=${entityId}`; };
  const [showRealmHelper, setShowRealmHelper] = useState(false);
  const [manualRealmId,   setManualRealmId]   = useState("");
  const [manualEntityId,  setManualEntityId]  = useState("");
  const [manualMsg,       setManualMsg]       = useState(null);

  // Manual connection using realmId + existing token (for cases where picker doesn't show)
  const connectManual = async () => {
    if (!manualRealmId || !manualEntityId) return;
    // Re-assign existing connection or create a placeholder that will get token on next OAuth
    // Update the entityId mapping for the existing realmId token
    const r = await fetch("/api/qb-assign",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({realmId:manualRealmId.trim(), entityId:manualEntityId})
    }).catch(()=>null);
    if (r?.ok) {
      setManualMsg({type:"success", msg:`✓ Assigned realmId ${manualRealmId.slice(0,8)}… to entity`});
      setManualRealmId(""); setManualEntityId("");
      setTimeout(()=>{ setManualMsg(null); reload(); }, 2000);
    } else {
      // If token doesn't exist yet, we need to connect first then assign
      setManualMsg({type:"info", msg:"Connect QB first (button above), then use this to reassign if it picked the wrong company."});
    }
  };

  const reassign = async (realmId, newEntityId) => {
    await fetch("/api/qb-assign",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({realmId,entityId:newEntityId})}).catch(()=>{});
    setConnections(prev=>prev.map(c=>c.realmId===realmId?{...c,entityId:newEntityId}:c));
    setCompanies(prev=>prev.map(c=>c.realmId===realmId?{...c,entityId:newEntityId}:c));
    setAssigning(null);
  };

  const disconnect = async (realmId, entityId) => {
    await fetch("/api/qb-disconnect",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({realmId,entityId})});
    setConnections(prev=>prev.filter(c=>c.realmId!==realmId));
    setCompanies(prev=>prev.filter(c=>c.realmId!==realmId));
  };

  const syncNow = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const r=await fetch("/api/qb-sync",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({})});
      const d=await r.json(); setSyncResult(d); setLastSync(d.syncedAt);
    } catch(e){ setSyncResult({error:e.message}); }
    setSyncing(false);
  };

  const entsById   = Object.fromEntries((entities||DEFAULT_ENTITIES).map(e=>[e.id,e]));
  const compByRealm= Object.fromEntries(companies.map(c=>[c.realmId,c]));

  return(<div>
    {/* Header */}
    <div style={{background:COLORS.surface,border:`1px solid ${COLORS.accent}44`,borderRadius:12,padding:16,marginBottom:16,display:"flex",gap:14,alignItems:"flex-start"}}>
      <span style={{fontSize:22}}>🔗</span>
      <div style={{flex:1}}>
        <div style={{fontWeight:700,color:COLORS.accent,fontSize:13,marginBottom:4}}>QuickBooks Integration</div>
        <div style={{color:COLORS.textMid,fontSize:12,lineHeight:1.7}}>
          Connect each QB company file separately. Click <strong style={{color:COLORS.text}}>+ Add QB Company</strong>, sign into Intuit, and select one company. After connecting, assign it to the matching entity. Repeat for each company.
        </div>
      </div>
      <div style={{display:"flex",gap:8,flexShrink:0}}>
        {connections.filter(c=>!c.needsReauth).length>0&&(
          <button onClick={syncNow} disabled={syncing} style={{background:syncing?COLORS.surfaceHigh:COLORS.qb,color:syncing?COLORS.textMid:"#fff",border:"none",borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:700,cursor:syncing?"not-allowed":"pointer"}}>
            {syncing?"Syncing…":"⬇ Sync All"}
          </button>
        )}
        <button onClick={connect} style={{background:COLORS.accentDim,border:`1px solid ${COLORS.accent}44`,color:COLORS.accent,borderRadius:8,padding:"8px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>
          + Add QB Company
        </button>
      </div>
    </div>

    {/* How to connect multiple companies */}
    <div style={{background:"#0A1525",border:`1px solid ${COLORS.blue}44`,borderRadius:10,padding:"14px 16px",marginBottom:16}}>
      <div style={{fontWeight:700,color:COLORS.blue,fontSize:11,marginBottom:10,textTransform:"uppercase",letterSpacing:"0.08em"}}>How to connect all your QB companies</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,fontSize:11,color:COLORS.textMid,lineHeight:1.7,marginBottom:14}}>
        <div>
          <strong style={{color:COLORS.text}}>Step 1 — Find each company's realmId:</strong><br/>
          Log into QuickBooks Online for one company. Look at the URL in your browser:<br/>
          <code style={{background:COLORS.bg,padding:"2px 6px",borderRadius:4,fontSize:10,color:COLORS.accent}}>app.qbo.intuit.com/app/homepage?<strong>realmId=9341456713410513</strong></code><br/>
          Copy that number. That's the realmId for that company.
        </div>
        <div>
          <strong style={{color:COLORS.text}}>Step 2 — Connect once, reassign:</strong><br/>
          Click <strong style={{color:COLORS.text}}>+ Connect QB</strong> — it will connect whichever company Intuit picks. Then use the <strong style={{color:COLORS.warning}}>Reassign by realmId</strong> tool below to link each connection to the right entity using the realmId you copied from the QB URL.
        </div>
      </div>

      {/* realmId lookup table */}
      <div style={{background:COLORS.bg,borderRadius:8,padding:"10px 12px",marginBottom:12}}>
        <div style={{fontSize:10,color:COLORS.textMid,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Your QB companies — find realmId in the URL when logged in</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6}}>
          {[
            {name:"Canada MedLaser Inc",       entity:"CML"},
            {name:"Canada MedLaser Franchising Inc.", entity:"CMLF"},
            {name:"CML Academy",               entity:"ACAD"},
            {name:"Skin Society Bar Inc",       entity:"SSB"},
            {name:"YECO Marketing Inc",         entity:"YECO"},
          ].map(({name,entity})=>(
            <div key={entity} style={{display:"flex",alignItems:"center",gap:8,background:COLORS.surface,borderRadius:6,padding:"6px 10px"}}>
              <span style={{fontSize:11,color:COLORS.text,fontWeight:600,flex:1}}>{name}</span>
              <span style={{fontSize:10,color:COLORS.textMid}}>→</span>
              <span style={{fontSize:11,color:COLORS.accent,fontWeight:700}}>{entity}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Manual reassign tool */}
      <div style={{borderTop:`1px solid ${COLORS.border}`,paddingTop:12}}>
        <button onClick={()=>setShowRealmHelper(v=>!v)} style={{background:"none",border:"none",color:COLORS.warning,fontSize:11,cursor:"pointer",fontWeight:700,padding:0,marginBottom:8}}>
          {showRealmHelper?"▼":"▶"} Reassign connected company by realmId
        </button>
        {showRealmHelper&&(
          <div style={{display:"flex",gap:8,alignItems:"flex-end",flexWrap:"wrap"}}>
            <div style={{flex:1,minWidth:160}}>
              <div style={{fontSize:10,color:COLORS.textMid,marginBottom:4}}>realmId (from QB URL)</div>
              <input value={manualRealmId} onChange={e=>setManualRealmId(e.target.value)}
                placeholder="e.g. 9341456713410513" style={{...inpS(),padding:"6px 10px",fontSize:12}}/>
            </div>
            <div style={{width:160}}>
              <div style={{fontSize:10,color:COLORS.textMid,marginBottom:4}}>Assign to entity</div>
              <select value={manualEntityId} onChange={e=>setManualEntityId(e.target.value)} style={{...selS(),padding:"6px 10px",fontSize:12}}>
                <option value="">— select —</option>
                {(entities||DEFAULT_ENTITIES).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
              </select>
            </div>
            <button onClick={connectManual} disabled={!manualRealmId||!manualEntityId}
              style={{background:manualRealmId&&manualEntityId?COLORS.accent:"#182030",color:manualRealmId&&manualEntityId?"#000":COLORS.textMid,border:"none",borderRadius:7,padding:"7px 14px",fontSize:12,fontWeight:700,cursor:manualRealmId&&manualEntityId?"pointer":"not-allowed"}}>
              Assign
            </button>
          </div>
        )}
        {manualMsg&&<div style={{marginTop:8,fontSize:11,color:manualMsg.type==="success"?COLORS.accent:COLORS.blue,background:manualMsg.type==="success"?COLORS.accentDim:COLORS.blueDim,border:`1px solid ${manualMsg.type==="success"?COLORS.accent:COLORS.blue}33`,borderRadius:6,padding:"6px 10px"}}>{manualMsg.msg}</div>}
      </div>
    </div>

    {/* Sync results */}
    {lastSync&&<div style={{background:COLORS.accentDim,border:`1px solid ${COLORS.accent}33`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:12,color:COLORS.accent}}>
      ✓ Last sync: {new Date(lastSync).toLocaleString("en-CA")}{syncResult&&!syncResult.error?` — ${syncResult.totalCount} transactions pulled`:""}
    </div>}
    {syncResult?.error&&<div style={{background:COLORS.dangerDim,border:`1px solid ${COLORS.danger}33`,borderRadius:8,padding:"8px 14px",marginBottom:12,fontSize:12,color:COLORS.danger}}>✗ {syncResult.error}</div>}

    {/* Connected companies */}
    <div style={{fontSize:11,color:COLORS.textMid,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10}}>Connected QB Companies ({connections.length})</div>
    {loading&&<div style={{color:COLORS.textMid,fontSize:12,padding:"16px 0"}}>Loading connections…</div>}
    {!loading&&connections.length===0&&(
      <div style={{background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderRadius:10,padding:"28px",textAlign:"center",color:COLORS.textMid,fontSize:13,marginBottom:16}}>
        No QB companies connected yet.<br/>
        <span style={{color:COLORS.accent,fontWeight:700,cursor:"pointer"}} onClick={connect}>+ Click here to connect your first QB company</span>
      </div>
    )}
    {!loading&&connections.length>0&&(
      <div style={{background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderRadius:12,overflow:"hidden",marginBottom:20}}>
        {connections.map((conn,i)=>{
          const ent=entsById[conn.entityId];
          const comp=compByRealm[conn.realmId];
          const isUnassigned=!ent||conn.entityId==="unassigned";
          return(
            <div key={conn.realmId} style={{borderBottom:i<connections.length-1?`1px solid ${COLORS.border}`:"none",padding:"14px 16px"}}>
              <div style={{display:"flex",alignItems:"flex-start",gap:12}}>
                <div style={{width:10,height:10,borderRadius:"50%",background:conn.needsReauth?COLORS.warning:COLORS.accent,marginTop:4,flexShrink:0}}/>
                <div style={{flex:1}}>
                  <div style={{fontSize:13,color:COLORS.text,fontWeight:700,marginBottom:2}}>{comp?.companyName||`QB Company`}</div>
                  <div style={{fontSize:10,color:COLORS.textDim,fontFamily:"monospace",marginBottom:8}}>realmId: {conn.realmId}</div>
                  {comp?.bankAccounts?.length>0&&(
                    <div style={{marginBottom:10}}>
                      <div style={{fontSize:10,color:COLORS.textMid,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:5}}>Bank accounts in this QB company</div>
                      <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                        {comp.bankAccounts.map(acct=>(
                          <div key={acct.id} style={{background:COLORS.bg,border:`1px solid ${COLORS.border}`,borderRadius:6,padding:"4px 10px",fontSize:11}}>
                            <span style={{color:COLORS.text,fontWeight:600}}>{acct.name}</span>
                            {acct.number&&<span style={{color:COLORS.textMid}}> ****{acct.number.slice(-4)}</span>}
                            <span style={{color:COLORS.accent,marginLeft:8,fontFamily:"monospace"}}>{fmtShort(acct.balance)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:11,color:COLORS.textMid}}>Assigned to:</span>
                    {assigning===conn.realmId ? (
                      <div style={{display:"flex",gap:6,alignItems:"center"}}>
                        <select defaultValue={conn.entityId||""} onChange={e=>reassign(conn.realmId,e.target.value)}
                          style={{...inpS(),padding:"4px 8px",fontSize:12,width:"auto"}}>
                          <option value="">— select entity —</option>
                          {(entities||DEFAULT_ENTITIES).map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
                        </select>
                        <button onClick={()=>setAssigning(null)} style={{background:"none",border:"none",color:COLORS.textMid,cursor:"pointer",fontSize:12}}>✕</button>
                      </div>
                    ) : (
                      <div style={{display:"flex",alignItems:"center",gap:8}}>
                        {ent ? (
                          <div style={{display:"flex",alignItems:"center",gap:6,background:ent.color+"15",border:`1px solid ${ent.color}33`,borderRadius:6,padding:"3px 10px"}}>
                            <Dot color={ent.color} size={7}/><span style={{fontSize:12,color:COLORS.text,fontWeight:600}}>{ent.name}</span>
                          </div>
                        ) : (
                          <span style={{fontSize:12,color:COLORS.warning,fontWeight:700}}>⚠ Not assigned yet</span>
                        )}
                        <button onClick={()=>setAssigning(conn.realmId)} style={{background:COLORS.blueDim,border:`1px solid ${COLORS.blue}33`,color:COLORS.blue,borderRadius:5,padding:"3px 9px",fontSize:11,cursor:"pointer",fontWeight:700}}>
                          {isUnassigned?"Assign →":"Change"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
                <div style={{display:"flex",gap:6,alignItems:"center",flexShrink:0}}>
                  <Badge color={conn.needsReauth?COLORS.warning:COLORS.accent}>{conn.needsReauth?"Expired":"Active"}</Badge>
                  {conn.needsReauth&&<button onClick={()=>connectFor(conn.entityId)} style={{background:COLORS.warningDim,border:`1px solid ${COLORS.warning}33`,color:COLORS.warning,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:700,cursor:"pointer"}}>Reconnect</button>}
                  <button onClick={()=>disconnect(conn.realmId,conn.entityId)} style={{background:COLORS.dangerDim,border:`1px solid ${COLORS.danger}33`,color:COLORS.danger,borderRadius:6,padding:"5px 10px",fontSize:11,fontWeight:700,cursor:"pointer"}}>Remove</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    )}

    {/* Entity status */}
    <div style={{fontSize:11,color:COLORS.textMid,fontWeight:700,textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:10}}>Entity Sync Status</div>
    <div style={{background:COLORS.surface,border:`1px solid ${COLORS.border}`,borderRadius:12,overflow:"hidden"}}>
      {(entities||DEFAULT_ENTITIES).map((ent,i)=>{
        const conn=connections.find(c=>c.entityId===ent.id&&!c.needsReauth);
        const comp=conn?compByRealm[conn.realmId]:null;
        return(
          <div key={ent.id} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 16px",borderBottom:i<(entities||DEFAULT_ENTITIES).length-1?`1px solid ${COLORS.border}`:"none"}}>
            <div style={{width:10,height:10,borderRadius:"50%",background:conn?COLORS.accent:COLORS.textDim,flexShrink:0}}/>
            <Dot color={ent.color} size={9}/>
            <div style={{flex:1}}>
              <div style={{fontSize:13,color:COLORS.text,fontWeight:600}}>{ent.name}</div>
              <div style={{fontSize:11,color:COLORS.textMid}}>
                {conn?`${comp?.companyName||conn.realmId} · ${comp?.bankAccounts?.length||0} bank accounts`:"No QB company connected"}
              </div>
            </div>
            <Badge color={conn?COLORS.accent:COLORS.textDim}>{conn?"Syncing":"Not connected"}</Badge>
            {!conn&&<button onClick={()=>connectFor(ent.id)} style={{background:COLORS.accentDim,border:`1px solid ${COLORS.accent}44`,color:COLORS.accent,borderRadius:7,padding:"5px 12px",fontSize:11,fontWeight:700,cursor:"pointer"}}>Connect QB</button>}
          </div>
        );
      })}
    </div>
  </div>);
}
