import { createServer } from 'node:http'
const server = createServer((req, res) => {
  const url = new URL(req.url || '/', 'http://localhost')
  res.setHeader('content-type', 'application/fhir+json')
  if (url.pathname === '/fhir/metadata') {
    res.end(JSON.stringify({ resourceType: 'CapabilityStatement', fhirVersion: '4.0.1', status: 'active' }))
    return
  }
  if (url.pathname === '/fhir/Patient') {
    res.end(JSON.stringify({ resourceType: 'Bundle', type: 'searchset', entry: [{ resource: {
      resourceType: 'Patient', id: 'remote-1',
      identifier: [{ system: 'urn:afribok:hospital-number', value: url.searchParams.get('identifier') || 'AFB-1001' }],
      name: [{ use: 'official', family: 'Yusuf', given: ['Amina', 'Halima'] }],
      gender: 'female', birthDate: '1992-06-15',
      telecom: [{ system: 'phone', value: '0809 999 0000' }],
      address: [{ line: ['12 Unity Road'], city: 'Abuja', state: 'FCT' }],
    } }] }))
    return
  }
  if (url.pathname === '/fhir/DocumentReference' && req.method === 'POST') {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const parsed = JSON.parse(body || '{}')
      if (!parsed.subject?.reference) { res.statusCode = 400; res.end(JSON.stringify({ resourceType: 'OperationOutcome' })); return }
      res.statusCode = 201
      res.end(JSON.stringify({ resourceType: 'DocumentReference', id: 'doc-1' }))
    })
    return
  }
  res.statusCode = 404
  res.end(JSON.stringify({ resourceType: 'OperationOutcome' }))
})
server.listen(4100, '127.0.0.1', () => console.log('mock FHIR on 4100'))
