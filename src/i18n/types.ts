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
  | 'import-wizard'
  | 'projects-canvas';

export type Dictionary = Record<string, string | string[] | Record<string, unknown>>;
