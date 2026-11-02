const base='https://afribok.vertexsautomations.com'
const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'live.132115@afribok.test',password:'live-verification-2026'})})
const cookie=(login.headers.get('set-cookie')||'').split(';')[0]
if(!cookie){console.log('FAIL login',login.status);process.exit(1)}
const boot=await fetch(base+'/api/bootstrap',{headers:{cookie}}).then(r=>r.json())
const patient=boot.patients.find(p=>p.firstName==='Amina')
const encounter=boot.encounters.find(e=>e.patientId===patient.id)
console.log('patient',patient.id,'encounter',encounter.id,'phone before',patient.phone)
const pull=await fetch(base+'/api/ehr/patients/'+patient.id+'/pull',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'}).then(async r=>({status:r.status,body:await r.json()}))
console.log('pull',pull.status,pull.body.patient?.phone,pull.body.error||'')
const push1=await fetch(base+'/api/ehr/encounters/'+encounter.id+'/push-note',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'}).then(async r=>({status:r.status,body:await r.json()}))
const push2=await fetch(base+'/api/ehr/encounters/'+encounter.id+'/push-note',{method:'POST',headers:{cookie,'content-type':'application/json'},body:'{}'}).then(async r=>({status:r.status,body:await r.json()}))
console.log('push1',push1.status,push1.body.remoteId||push1.body.error||'')
console.log('push2',push2.status,push2.body.alreadySynced,push2.body.message||push2.body.error||'')
const ok=pull.status===200&&pull.body.patient?.phone==='0809 999 0000'&&push1.status===200&&push1.body.remoteId==='doc-1'&&push2.body.alreadySynced===true
console.log(ok?'EHR_RETEST_PASS':'EHR_RETEST_FAIL')
process.exit(ok?0:1)
