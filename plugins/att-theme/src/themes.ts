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
  table?: {
    rowHover?: string;
    rowSelected?: string;
  };
  status?: {
    success?: StatusTheme;
    warning?: StatusTheme;
    error?: StatusTheme;
    neutral?: StatusTheme;
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

interface StatusTheme {
  background?: string;
  text?: string;
  border?: string;
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
  table: {
    rowHover: '#E4F2FA',
    rowSelected: '#E6F4FF',
  },
  status: {
    success: { background: '#DFF7E8', text: '#17643A', border: '#9BE7B2' },
    warning: { background: '#FFF4BF', text: '#5F4B00', border: '#FFE066' },
    error: { background: '#FDE2E1', text: '#8F1D1B', border: '#F7A8A6' },
    neutral: { background: '#EEF2F6', text: '#394150', border: '#CDD5DF' },
  },
  sidebar: {
    background: '#ffffff',
    color: '#31465a',
    selectedBackground: '#009fdb',
    // also used as text color for selected sub-items, so must contrast with the light sidebar
    selectedColor: '#0079ad',
    actionBackground: '#e9eff5',
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
    default: '#0B121A',
    surface: '#101820',
    muted: '#17212B',
  },
  table: {
    rowHover: '#152534',
    rowSelected: '#18314A',
  },
  status: {
    success: { background: '#123522', text: '#9BE7B2', border: '#2F7D4D' },
    warning: { background: '#332B08', text: '#FFE680', border: '#75640D' },
    error: { background: '#4A1716', text: '#FFB4B1', border: '#8F3431' },
    neutral: { background: '#242A32', text: '#D7DEE8', border: '#46505C' },
  },
  sidebar: {
    background: '#101820',
    color: '#b8c8da',
    selectedBackground: '#009fdb',
    selectedColor: '#ffffff',
    actionBackground: '#17212B',
  },
  navbar: {
    background: '#101820',
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
