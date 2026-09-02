import { Icon } from '@iconify/react';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { getViewportPointFromElement, runThemeModeTransition } from './themeTransition';

const LIGHT_THEME = 'AT&T Light';
const DARK_THEME = 'AT&T Dark';
const SUN_COLOR = '#e0a33e';

export function ThemeToggle() {
  const dispatch = useDispatch();
  const themeName = useSelector((state: any) => state.theme?.name || '');
  const isDark = themeName.toLowerCase().includes('dark');
  const btnRef = useRef<HTMLButtonElement>(null);

  // Default to AT&T Light on first load when user has no saved preference.
  useEffect(() => {
    if (!localStorage.getItem('headlampThemePreference')) {
      dispatch({ type: 'theme/setTheme', payload: LIGHT_THEME });
    }
  }, [dispatch]);

  const applyThemeChange = () => {
    dispatch({ type: 'theme/setTheme', payload: isDark ? LIGHT_THEME : DARK_THEME });
  };

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    runThemeModeTransition(applyThemeChange, {
      origin: getViewportPointFromElement(event.currentTarget),
    });
  };

  return (
    <Tooltip title={isDark ? 'Switch to light' : 'Switch to dark'}>
      <IconButton
        ref={btnRef}
        onClick={handleClick}
        size="medium"
        sx={{
          color: 'inherit',
          borderRadius: '50%',
          mx: 1.5,
          p: 1,
          backgroundColor: isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.04)',
          transition: 'background-color 0.3s ease, transform 0.3s ease',
          '&:hover': {
            backgroundColor: isDark ? 'rgba(255, 255, 255, 0.16)' : 'rgba(0, 0, 0, 0.08)',
          },
          '&:active': {
            transform: 'scale(0.9)',
          },
        }}
      >
        <Icon
          icon={isDark ? 'mdi:weather-night' : 'clarity:sun-solid'}
          width={24}
          height={24}
          color={isDark ? undefined : SUN_COLOR}
        />
      </IconButton>
    </Tooltip>
  );
}
