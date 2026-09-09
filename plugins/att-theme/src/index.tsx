import { registerAppBarAction, registerAppTheme } from '@kinvolk/headlamp-plugin/lib';
import { ApiStatusIndicator } from './ApiHealthBadge';
import { attDarkTheme, attLightTheme } from './themes';
import { ThemeToggle } from './ThemeToggle';
import { UserProfileAvatar } from './UserProfileAvatar';

// Guards against duplicate registration if this module gets executed more than
// once (e.g. dev-server hot reload), which previously caused the app bar
// buttons to be appended and rendered multiple times.
if (!(window as any).__attThemePluginRegistered) {
  (window as any).__attThemePluginRegistered = true;

  registerAppTheme(attLightTheme);
  registerAppTheme(attDarkTheme);

  registerAppBarAction(ApiStatusIndicator);
  registerAppBarAction(ThemeToggle);
  registerAppBarAction(UserProfileAvatar);
}

