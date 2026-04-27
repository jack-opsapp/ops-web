export type Locale = 'en' | 'es';

export type Namespace =
  | 'common'
  | 'auth'
  | 'sidebar'
  | 'topbar'
  | 'breadcrumbs'
  | 'settings'
  | 'portal'
  | 'dashboard'
  | 'projects'
  | 'clients'
  | 'calendar'
  | 'schedule'
  | 'pipeline'
  | 'accounting'
  | 'inbox'
  | 'compose'
  | 'email-templates'
  | 'forms'
  | 'intel'
  | 'ai-drafting'
  | 'ai-setup'
  | 'import-wizard'
  | 'projects-canvas'
  | 'duplicates'
  | 'autonomy'
  | 'agent-queue'
  | 'scheduling'
  | 'client-comms'
  | 'comms-wizard'
  | 'calibration'
  | 'notifications'
  | 'quick-actions'
  | 'server-emails';


export type Dictionary = Record<string, string | string[] | Record<string, unknown>>;
