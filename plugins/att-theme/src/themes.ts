export interface AppTheme {
  name: string;
  base?: 'light' | 'dark';
  primary?: string;
  secondary?: string;
  secondaryContrastText?: string;
  text?: {
    primary?: string;
  };
  link?: {
    color?: string;
  };
  background?: {
    default?: string;
    surface?: string;
    muted?: string;
  };
  sidebar?: {
    background?: string;
    color?: string;
    selectedBackground?: string;
    selectedColor?: string;
    actionBackground?: string;
  };
  navbar?: {
    background?: string;
    color?: string;
    searchHint?: string;
  };
  radius?: number;
  buttonTextTransform?: 'uppercase' | 'none';
  fontFamily?: string[];
  terminal?: {
    background?: string;
    foreground?: string;
    cursor?: string;
    ansi?: Partial<Record<string, string>>;
  };
}

export const attLightTheme: AppTheme = {
  name: 'AT&T Light',
  base: 'light',
  primary: '#009fdb',
  secondary: '#f3f5f8',
  text: {
    primary: '#0f1f2e',
  },
  link: {
    color: '#009fdb',
  },
  background: {
    default: '#f3f5f8',
    surface: '#ffffff',
    muted: '#e9eff5',
  },
  sidebar: {
    background: '#0f1f2e',
    color: '#eaf2fb',
    selectedBackground: '#009fdb',
    selectedColor: '#ffffff',
    actionBackground: '#162334',
  },
  navbar: {
    background: '#ffffff',
    color: '#0f1f2e',
    searchHint: '#4e6072',
  },
  buttonTextTransform: 'none',
  radius: 10,
  fontFamily: [
    'Avenir Next',
    'Segoe UI Variable',
    'Segoe UI',
    'Helvetica Neue',
    'Arial',
    'sans-serif',
  ],
  terminal: {
    background: '#0b131c',
    foreground: '#eaf2fb',
    cursor: '#009fdb',
  },
};

export const attDarkTheme: AppTheme = {
  name: 'AT&T Dark',
  base: 'dark',
  primary: '#009fdb',
  secondary: '#162334',
  text: {
    primary: '#eaf2fb',
  },
  link: {
    color: '#009fdb',
  },
  background: {
    default: '#0b131c',
    surface: '#101a26',
    muted: '#162334',
  },
  sidebar: {
    background: '#0b131c',
    color: '#b8c8da',
    selectedBackground: '#009fdb',
    selectedColor: '#ffffff',
    actionBackground: '#162334',
  },
  navbar: {
    background: '#101a26',
    color: '#eaf2fb',
    searchHint: '#b8c8da',
  },
  buttonTextTransform: 'none',
  radius: 10,
  fontFamily: [
    'Avenir Next',
    'Segoe UI Variable',
    'Segoe UI',
    'Helvetica Neue',
    'Arial',
    'sans-serif',
  ],
  terminal: {
    background: '#0b131c',
    foreground: '#eaf2fb',
    cursor: '#009fdb',
  },
};
