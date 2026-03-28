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
  | 'forms';

export type Dictionary = Record<string, string | string[] | Record<string, unknown>>;
