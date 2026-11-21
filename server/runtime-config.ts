export function appOrigin(value=process.env.APP_ORIGIN) {
 if(!value)return undefined;
 const candidate=/^[a-z][a-z\d+.-]*:\/\//i.test(value)?value:`https://${value}`;
 try{const url=new URL(candidate);if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)return undefined;return url.origin;}catch{return undefined;}
}
export function runtimeReadiness() {
 return {
  APP_ORIGIN:appOrigin()?.startsWith('https://')===true,
  AUTH_TOKEN_KEY:(process.env.AUTH_TOKEN_KEY||'').length>=24,
  HR_SETUP_KEY:(process.env.HR_SETUP_KEY||'').length>=32,
  SCHEDULER_SECRET:(process.env.SCHEDULER_SECRET||'').length>=24,
 };
}
