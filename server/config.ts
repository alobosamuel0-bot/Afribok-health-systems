import type { Facility } from '../shared/types'

export const FACILITY: Facility = {
  id: 'northstar-live',
  name: 'Northstar Clinic',
  location: 'Abuja, Nigeria',
  mode: 'LIVE',
  // Overridden per facility from the stored onboarding answers.
  onboardingComplete: false,
  registrationFields: {
    dateOfBirth: 'required',
    phone: 'required',
    address: 'required',
    nationalIdentifier: 'required',
  },
  enabledModules: ['patients', 'encounters', 'offline_sync', 'audit', 'team', 'ehr', 'triage', 'scribe', 'ocr', 'forecast'],
  triageEnabled: true,
  voiceEnabled: true,
  ehrIntegrationEnabled: true,
}

export const SESSION_HOURS = 12
export const COOKIE_NAME = 'afribok_session'
export const MAX_SYNC_BATCH = 40
export const BUILD_STAGE = 'Stage 2 · live clinic deployment'
