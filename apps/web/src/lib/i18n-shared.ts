export const supportedLanguages = ['nl', 'en'] as const;

export type Language = string;

export const languageCookieName = 'splashtrack-language';

export function normalizeLanguage(value: string | null | undefined): Language {
  return value?.trim() || 'nl';
}

export function getCopyLanguage(language: Language): 'nl' | 'en' {
  return language === 'en' ? 'en' : 'nl';
}

export const dictionary = {
  nl: {
    common: {
      language: 'Taal',
      dutch: 'Nederlands',
      english: 'English',
      home: 'Home',
      dashboard: 'Dashboard',
      students: 'Studenten',
      groups: 'Groepen',
      organization: 'Organisatie',
      users: 'Gebruikers',
      welcomePage: 'Welkomstpagina',
      signOut: 'Uitloggen',
    },
    home: {
      eyebrow: 'Huidige basis',
      intro:
        'Next.js app-root met Better Auth, een minimale server-side RBAC skeleton en een kleine organization/admin foundation voor de huidige single-org setup.',
      environment: 'Omgeving',
      baseUrl: 'Basis-URL',
      healthEndpoint: 'Health endpoint',
      authEndpoint: 'Auth endpoint',
      currentUser: 'Huidige gebruiker',
      currentRole: 'Huidige rol',
      notLoggedIn: 'Niet ingelogd',
      noMembership: 'Geen membership',
      openDashboard: 'Open dashboard',
      goToLogin: 'Naar login',
      organizationShell: 'Organisatiebeheer',
    },
    login: {
      title: 'Inloggen',
      intro: 'Log in om het dashboard te openen.',
      email: 'E-mail',
      password: 'Wachtwoord',
      submit: 'Inloggen',
      pending: 'Bezig...',
      backHome: 'Terug naar home',
      failed: 'Inloggen is niet gelukt.',
    },
    dashboard: {
      sidebarIntro:
        'Protected shell op Better Auth + Prisma. Ingelogde users met actieve membership mogen hier binnen; organization admin onderdelen blijven beperkt tot OWNER/ADMIN.',
      user: 'Gebruiker',
      role: 'Rol',
      organization: 'Organisatie',
      capabilities: 'Rechten',
      noMembership: 'Geen membership',
      notLinked: 'Niet gekoppeld',
      navLabel: 'Dashboard navigatie',
      welcomeEyebrow: 'Startpunt',
      welcomeCardsLabel: 'Welkomstkaarten',
      editWelcomePage: 'Welkomstpagina bewerken',
      routeEyebrow: 'Afgeschermde route',
      title: 'Welkom in de dashboard shell',
      intro:
        'Dit blijft bewust een technische basisroute. De app levert nu auth, RBAC, een kleine organization/admin foundation en een eerste business-slice voor studenten.',
      authGuard: 'Auth guard',
      authGuardBody: 'Server-side redirect naar login voor unauthenticated verkeer.',
      rbacGuard: 'RBAC guard',
      rbacGuardBody: 'Minimale rol/capability-checks via auth-context helper.',
      organizationShell: 'Organization shell',
      organizationShellBody:
        'OWNER/ADMIN krijgen een read-only beheerbasis voor memberships en audit-log context.',
      studentDirectory: 'Studentoverzicht',
      studentDirectoryBody:
        'Alle ingelogde dashboard-users met actieve membership kunnen nu een eerste read-only studentoverzicht openen.',
      openStudentDirectory: 'Open studentoverzicht',
      organizationAdmin: 'Organisatiebeheer',
      organizationAdminBody:
        'Je huidige rol heeft toegang tot de minimale organization beheerweergave voor deze single-org foundation.',
      openOrganizationShell: 'Open organisatiebeheer',
      openUserAdmin: 'Open gebruikersbeheer',
      limitedAccess: 'Beperkte dashboardtoegang',
      limitedAccessBody:
        'Je membership geeft wel dashboardtoegang, maar geen organization admin rechten. Dat is bewust server-side afgedwongen.',
    },
  },
  en: {
    common: {
      language: 'Language',
      dutch: 'Nederlands',
      english: 'English',
      home: 'Home',
      dashboard: 'Dashboard',
      students: 'Students',
      groups: 'Groups',
      organization: 'Organization',
      users: 'Users',
      welcomePage: 'Welcome page',
      signOut: 'Sign out',
    },
    home: {
      eyebrow: 'Current foundation',
      intro:
        'Next.js app root with Better Auth, a minimal server-side RBAC skeleton, and a small organization/admin foundation for the current single-org setup.',
      environment: 'Environment',
      baseUrl: 'Base URL',
      healthEndpoint: 'Health endpoint',
      authEndpoint: 'Auth endpoint',
      currentUser: 'Current user',
      currentRole: 'Current role',
      notLoggedIn: 'Not signed in',
      noMembership: 'No membership',
      openDashboard: 'Open dashboard',
      goToLogin: 'Go to login',
      organizationShell: 'Organization shell',
    },
    login: {
      title: 'Login',
      intro: 'Log in to open the dashboard.',
      email: 'Email',
      password: 'Password',
      submit: 'Log in',
      pending: 'Working...',
      backHome: 'Back to home',
      failed: 'Login failed.',
    },
    dashboard: {
      sidebarIntro:
        'Protected shell on Better Auth + Prisma. Signed-in users with active membership can enter; organization admin areas remain limited to OWNER/ADMIN.',
      user: 'User',
      role: 'Role',
      organization: 'Organization',
      capabilities: 'Capabilities',
      noMembership: 'No membership',
      notLinked: 'Not linked',
      navLabel: 'Dashboard navigation',
      welcomeEyebrow: 'Starting point',
      welcomeCardsLabel: 'Welcome cards',
      editWelcomePage: 'Edit welcome page',
      routeEyebrow: 'Protected route',
      title: 'Welcome to the dashboard shell',
      intro:
        'This is intentionally still a technical foundation route. The app now provides auth, RBAC, a small organization/admin foundation, and the first business slice for students.',
      authGuard: 'Auth guard',
      authGuardBody: 'Server-side redirect to login for unauthenticated traffic.',
      rbacGuard: 'RBAC guard',
      rbacGuardBody: 'Minimal role/capability checks via the auth-context helper.',
      organizationShell: 'Organization shell',
      organizationShellBody: 'OWNER/ADMIN get a read-only management foundation for memberships and audit-log context.',
      studentDirectory: 'Student directory',
      studentDirectoryBody: 'All signed-in dashboard users with active membership can now open the first read-only student directory.',
      openStudentDirectory: 'Open student directory',
      organizationAdmin: 'Organization admin',
      organizationAdminBody: 'Your current role has access to the minimal organization management view for this single-org foundation.',
      openOrganizationShell: 'Open organization shell',
      openUserAdmin: 'Open user admin',
      limitedAccess: 'Limited dashboard access',
      limitedAccessBody: 'Your membership gives dashboard access, but no organization admin rights. This is intentionally enforced server-side.',
    },
  },
} as const;
