import { registerAppBarAction, registerAppTheme } from '@kinvolk/headlamp-plugin/lib';
import { ApiHealthBadge } from './ApiHealthBadge';
import { attDarkTheme, attLightTheme } from './themes';
import { ThemeToggle } from './ThemeToggle';
import { UserProfileAvatar } from './UserProfileAvatar';

// 1. Register AT&T Light & Dark themes
registerAppTheme(attLightTheme);
registerAppTheme(attDarkTheme);

// 2. Register Header Action Buttons (API Health, Sun/Moon Theme Toggle, User Avatar)
registerAppBarAction(ApiHealthBadge);
registerAppBarAction(ThemeToggle);
registerAppBarAction(UserProfileAvatar);

