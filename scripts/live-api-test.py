#!/usr/bin/env python3
"""Live end-to-end check of Afribok's four clinical AI features over HTTPS."""
import base64
import http.cookiejar
import json
import os
import sys
import time
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get('AFRIBOK_BASE', 'https://afribok.vertexsautomations.com')
PASSWORD = 'Afribok#2026'
FIXTURES = os.environ.get('AFRIBOK_FIXTURES', '/tmp/afribok-live')

results = []


def note(name, ok, detail=''):
    results.append((name, ok, detail))
    print(('PASS ' if ok else 'FAIL ') + name + ((' — ' + str(detail)) if detail else ''))


class Client:
    def __init__(self, email):
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.email = email

    def call(self, method, path, body=None, timeout=180):
        data = json.dumps(body).encode() if body is not None else None
        request = urllib.request.Request(BASE + path, data=data, method=method)
        if data:
            request.add_header('content-type', 'application/json')
        try:
            with self.opener.open(request, timeout=timeout) as response:
                raw = response.read()
                return response.status, (json.loads(raw) if raw else None)
        except urllib.error.HTTPError as error:
            raw = error.read()
            try:
                parsed = json.loads(raw)
            except Exception:
                parsed = raw.decode('utf-8', 'replace')[:500]
            return error.code, parsed

    def login(self):
        status, body = self.call('POST', '/api/auth/login', {'email': self.email, 'password': PASSWORD})
        if status != 200:
            raise SystemExit(f'login failed for {self.email}: {status} {body}')
        return body['user']


def b64(path):
    with open(path, 'rb') as handle:
        return base64.b64encode(handle.read()).decode()


def main():
    registration = Client('registration@afribok.health')
    nurse = Client('nurse@afribok.health')
    admin = Client('admin@afribok.health')
    user_reg = registration.login()
    nurse.login()
    admin.login()
    note('sign-in (registration, nurse, admin)', True, user_reg['name'])

    status, ai = admin.call('GET', '/api/ai/status')
    note('AI status reachable', status == 200 and ai.get('configured') is True, ai)

    # --- OCR on a clean photograph -------------------------------------------------
    started = time.time()
    status, body = registration.call('POST', '/api/ai/ocr', {
        'imageBase64': b64(os.path.join(FIXTURES, 'clean.png')),
        'mimeType': 'image/png',
    })
    clean = body.get('extraction') if isinstance(body, dict) else None
    ok = status == 200 and clean and clean['fields']['firstName']['value'] and clean['fields']['lastName']['value']
    note('OCR clean paper record', bool(ok), f'{time.time() - started:.1f}s')
    if clean:
        print(json.dumps({k: v['value'] for k, v in clean['fields'].items()}, indent=2))
        print('confidence', clean['confidence'], 'legible', clean['legible'], 'doc', clean['documentType'])
        print('warnings', clean['warnings'])

    # --- OCR on a badly snapped photograph -----------------------------------------
    started = time.time()
    status, body = registration.call('POST', '/api/ai/ocr', {
        'imageBase64': b64(os.path.join(FIXTURES, 'poor.jpg')),
        'mimeType': 'image/jpeg',
    })
    poor = body.get('extraction') if isinstance(body, dict) else None
    ok = status == 200 and poor and poor['fields']['lastName']['value']
    note('OCR crooked, blurred, dim photo', bool(ok), f'{time.time() - started:.1f}s')
    if poor:
        print(json.dumps({k: v['value'] for k, v in poor['fields'].items()}, indent=2))
        print('confidence', poor['confidence'], 'legible', poor['legible'])
        print('warnings', poor['warnings'])
        print('field confidences', {k: v['confidence'] for k, v in poor['fields'].items()})

    # --- A disposable patient visit for triage + scribe ----------------------------
    stamp = int(time.time())
    patient_id = str(uuid.uuid4())
    encounter_id = str(uuid.uuid4())
    now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    status, body = registration.call('POST', '/api/sync', {
        'operations': [{
            'id': str(uuid.uuid4()),
            'type': 'register_patient',
            'clientTime': now,
            'payload': {
                'patient': {
                    'id': patient_id,
                    'hospitalNumber': f'AFB-{stamp % 10000:04d}',
                    'firstName': 'Chinwe',
                    'lastName': 'Okonkwo',
                    'otherNames': None,
                    'sex': 'female',
                    'dateOfBirth': '1987-04-12',
                    'phone': '0803 555 0177',
                    'address': '14 Ademola Street, Wuse 2, Abuja',
                    'identifierType': 'National ID',
                    'identifierValue': 'NIN-5521-0093',
                },
                'encounter': {
                    'id': encounter_id,
                    'arrivedAt': now,
                    'chiefComplaint': 'Fever and headache for 3 days',
                },
                'duplicateAcknowledged': True,
            },
        }],
    })
    applied = status == 200 and body['results'][0]['status'] in ('applied', 'duplicate')
    note('register test visit through sync', bool(applied), body['results'][0]['status'] if status == 200 else body)
    if not applied:
        return finish()

    # --- Triage --------------------------------------------------------------------
    started = time.time()
    status, body = nurse.call('POST', '/api/ai/triage', {
        'encounterId': encounter_id,
        'vitals': {'temperature': '38.6 °C', 'bloodPressure': '118/74', 'pulse': '96', 'oxygen': '97%'},
        'notes': 'Sore throat, no appetite, no vomiting. Chest clear on listening.',
    })
    triage = body.get('assessment') if isinstance(body, dict) else None
    ok = status == 200 and triage and 1 <= triage['level'] <= 5 and triage['disposition']
    note('AI triage with observations', bool(ok), f'{time.time() - started:.1f}s')
    if triage:
        print(json.dumps(triage, indent=2))
    else:
        print('triage error', status, body)

    # --- Triage without observations (thin information) ----------------------------
    status, body = nurse.call('POST', '/api/ai/triage', {'encounterId': encounter_id})
    thin = body.get('assessment') if isinstance(body, dict) else None
    note('AI triage on a bare complaint', status == 200 and thin is not None,
         (thin or {}).get('level'))
    if thin:
        print(json.dumps({k: thin[k] for k in ('level', 'label', 'disposition', 'confidence', 'reasoning')}, indent=2))

    # --- Scribe from recorded audio ------------------------------------------------
    started = time.time()
    status, body = nurse.call('POST', '/api/ai/scribe', {
        'encounterId': encounter_id,
        'audioBase64': b64(os.path.join(FIXTURES, 'consult.wav')),
        'mimeType': 'audio/wav',
        'audioSeconds': 52,
    }, timeout=300)
    scribe = body.get('note') if isinstance(body, dict) else None
    ok = status == 200 and scribe and scribe['assessment'] and scribe['plan']
    note('AI scribe from 52s recording', bool(ok), f'{time.time() - started:.1f}s')
    if scribe:
        print(json.dumps({k: scribe[k] for k in ('subjective', 'objective', 'assessment', 'plan', 'followUp', 'warnings', 'audioSeconds', 'model')}, indent=2))
        print('transcript:', scribe['transcript'][:400])
    else:
        print('scribe error', status, body)

    # --- Scribe from a pasted transcript -------------------------------------------
    status, body = nurse.call('POST', '/api/ai/scribe', {
        'encounterId': encounter_id,
        'transcript': 'Clinician: How is the cough today? Patient: Worse at night, and I coughed blood this morning. '
                      'Clinician: Any weight loss or night sweats? Patient: Yes, I have lost weight since January. '
                      'Clinician: Your chest sounds reduced at the right base. We will do a chest X-ray and sputum test today.',
    })
    note('AI scribe from pasted transcript', status == 200 and isinstance(body, dict) and body.get('note') is not None,
         ((body or {}).get('note') or {}).get('model') if isinstance(body, dict) else body)
    if status == 200:
        print(json.dumps({k: body['note'][k] for k in ('assessment', 'plan', 'warnings')}, indent=2))

    # --- Forecast ------------------------------------------------------------------
    started = time.time()
    for days in (30, 90, 365):
        status, body = admin.call('GET', f'/api/forecast?historyDays={days}&horizonHours=24')
        forecast = body.get('forecast') if isinstance(body, dict) else None
        ok = status == 200 and forecast and len(forecast['hours']) == 24 and len(forecast['days']) == 7
        note(f'outflow forecast ({days}-day history)', bool(ok), f'{time.time() - started:.1f}s')
        if forecast and days == 90:
            print(json.dumps({
                'history': forecast['history'],
                'now': forecast['now'],
                'peak hour': max(forecast['hours'], key=lambda h: h['expectedArrivals']),
                'days': [(d['weekday'], d['expectedVisits'], round(d['utilization'], 2), d['referralRecommended']) for d in forecast['days']],
                'equipment': forecast['equipment'],
                'referral': forecast['referral'],
                'assumptions': forecast['assumptions'],
                'model': forecast['model'],
            }, indent=2))

    # --- Capacity round trip -------------------------------------------------------
    current = admin.call('GET', '/api/capacity')[1]['capacity']
    updated = dict(current)
    updated['beds'] = current['beds']
    status, body = admin.call('PUT', '/api/capacity', updated)
    note('capacity read/write', status == 200 and body['capacity']['beds'] == current['beds'], status)

    print('\nTEST PATIENT', patient_id, encounter_id)
    finish()


def finish():
    failed = [name for name, ok, _ in results if not ok]
    print(f"\n{len(results) - len(failed)}/{len(results)} passed")
    if failed:
        print('failed:', ', '.join(failed))
        sys.exit(1)


if __name__ == '__main__':
    main()
