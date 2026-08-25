/*
 * Copyright 2025 The Kubernetes Authors
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { AppLogoProps, registerAppLogo } from '@kinvolk/headlamp-plugin/lib';
import { Box } from '@mui/material';
import AttGlobe from './att-globe.svg';

/**
 * The AT&T logo, shown in place of the default Headlamp logo.
 *
 * Headlamp renders whatever `registerAppLogo` provides in every place the app
 * logo appears (sidebar button, top bar, and the cluster chooser), passing
 * `logoType` ('small' for mobile, 'large' for desktop) and `themeName`
 * ('light' | 'dark').
 *
 * The AT&T globe is a colored (blue) mark, so a single SVG reads well on both
 * the light and dark themes — no per-theme variant is required — and it is used
 * for both the small and large logo slots.
 */
function AttLogo(props: AppLogoProps) {
  const { className, sx } = props;

  return (
    <Box
      component={AttGlobe}
      className={className}
      aria-label="AT&T"
      sx={{ height: '32px', width: 'auto', display: 'block', ...sx }}
    />
  );
}

registerAppLogo(AttLogo);
