import React from 'react'
import ReactDOM from 'react-dom/client'
import AuthGate from './App.jsx'

class ErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(e) { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{minHeight:'100vh',background:'#0A0E14',color:'#E8F0FC',fontFamily:'sans-serif',display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{maxWidth:500,textAlign:'center'}}>
            <div style={{fontSize:32,marginBottom:16}}>⚠️</div>
            <div style={{fontSize:18,fontWeight:700,marginBottom:12}}>CashFlow Pro failed to load</div>
            <div style={{fontSize:13,color:'#FF4D4D',background:'#2A0A0A',padding:'12px 16px',borderRadius:8,marginBottom:16,textAlign:'left',fontFamily:'monospace',wordBreak:'break-all'}}>
              {this.state.error?.message || String(this.state.error)}
            </div>
            <button onClick={()=>{ localStorage.clear(); sessionStorage.clear(); window.location.reload(); }}
              style={{background:'#00C896',color:'#000',border:'none',borderRadius:8,padding:'10px 24px',fontSize:14,fontWeight:700,cursor:'pointer'}}>
              Clear cache and reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <AuthGate />
  </ErrorBoundary>
)
