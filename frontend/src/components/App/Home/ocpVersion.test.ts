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

import { describe, expect, it } from 'vitest';
import { getOcpVersionFromClusterVersion, getOcpVersionFromKubernetesVersion } from './ocpVersion';

describe('getOcpVersionFromClusterVersion', () => {
  it('prefers the completed entry of the update history', () => {
    expect(
      getOcpVersionFromClusterVersion({
        status: {
          desired: { version: '4.16.22' },
          history: [
            { state: 'Partial', version: '4.16.22' },
            { state: 'Completed', version: '4.16.21' },
          ],
        },
      })
    ).toBe('4.16.21');
  });

  it('falls back to the desired version', () => {
    expect(
      getOcpVersionFromClusterVersion({
        status: { desired: { version: '4.16.22' }, history: [{ state: 'Partial' }] },
      })
    ).toBe('4.16.22');
  });

  it('returns null when there is no version', () => {
    expect(getOcpVersionFromClusterVersion({ status: {} })).toBeNull();
    expect(getOcpVersionFromClusterVersion(undefined)).toBeNull();
  });
});

describe('getOcpVersionFromKubernetesVersion', () => {
  it('maps OpenShift Kubernetes versions to their OCP release', () => {
    expect(getOcpVersionFromKubernetesVersion('v1.29.14+29b5494')).toBe('4.16');
    expect(getOcpVersionFromKubernetesVersion('v1.32.5+abcdef1')).toBe('4.19');
  });

  it('ignores versions from other distributions', () => {
    expect(getOcpVersionFromKubernetesVersion('v1.29.3')).toBeNull();
    expect(getOcpVersionFromKubernetesVersion('v1.29.5+k3s1')).toBeNull();
    expect(getOcpVersionFromKubernetesVersion('v1.29.3-gke.1093000')).toBeNull();
  });

  it('returns null for unknown or missing versions', () => {
    expect(getOcpVersionFromKubernetesVersion('v1.99.0+29b5494')).toBeNull();
    expect(getOcpVersionFromKubernetesVersion('')).toBeNull();
    expect(getOcpVersionFromKubernetesVersion(undefined)).toBeNull();
  });
});
