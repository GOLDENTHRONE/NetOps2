import { registerAppBarAction, registerAppTheme } from '@kinvolk/headlamp-plugin/lib';
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

  // API health badge intentionally not registered: no real metric has been
  // defined to track yet. Do not show fabricated/placeholder status.
  registerAppBarAction(ThemeToggle);
  registerAppBarAction(UserProfileAvatar);
}

