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

import nock from 'nock';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { setBackendToken } from '../../../../helpers/getHeadlampAPIHeaders';
import { findKubeconfigByClusterName } from '../../../../stateless/findKubeconfigByClusterName';
import { getUserIdFromLocalStorage } from '../../../../stateless/getUserIdFromLocalStorage';
import { getClusterAuthType } from '../v1/clusterRequests';
import { noteClusterAuthSuccess, reportClusterAuthFailure } from './authExpiry';
import { BASE_HTTP_URL, clusterFetch } from './fetch';

vi.mock('../../../auth', () => ({
  getToken: vi.fn(),
  setToken: vi.fn(),
}));

vi.mock('../../../../stateless/findKubeconfigByClusterName', () => ({
  findKubeconfigByClusterName: vi.fn(),
}));

vi.mock('../../../../stateless/getUserIdFromLocalStorage', () => ({
  getUserIdFromLocalStorage: vi.fn(),
}));

vi.mock('../v1/clusterRequests', () => ({
  getClusterAuthType: vi.fn(),
}));

vi.mock('../v1/tokenApi', () => ({
  refreshToken: vi.fn(),
}));

// P1 (#18): the auth-expiry reporter is mocked so we can assert exactly when clusterFetch
// classifies a response as a session-expiry (401) vs not (403/410/429/network/opt-out).
vi.mock('./authExpiry', () => ({
  reportClusterAuthFailure: vi.fn(),
  noteClusterAuthSuccess: vi.fn(),
}));

describe('clusterFetch', () => {
  const clusterName = 'test-cluster';
  const testUrl = '/test/url';
  const mockResponse = { message: 'mock response' };
  const kubeconfig = 'mock-kubeconfig';
  const userID = 'mock-user-id';

  beforeEach(() => {
    vi.resetAllMocks();
    setBackendToken('desktop-token');
    (findKubeconfigByClusterName as Mock).mockResolvedValue(kubeconfig);
    (getUserIdFromLocalStorage as Mock).mockReturnValue(userID);
    (getClusterAuthType as Mock).mockReturnValue('serviceAccount');
  });

  afterEach(() => {
    setBackendToken(null);
    nock.cleanAll();
  });

  it('Successfully makes a request', async () => {
    nock(BASE_HTTP_URL).get(`/clusters/${clusterName}${testUrl}`).reply(200, mockResponse);

    const response = await clusterFetch(testUrl, { cluster: clusterName });
    const responseBody = await response.json();

    expect(responseBody).toEqual(mockResponse);
  });

  it('does not add backend credentials to non-cluster requests', async () => {
    let backendTokenHeader: string | string[] | undefined;
    nock(BASE_HTTP_URL)
      .get(testUrl)
      .reply(function () {
        backendTokenHeader = this.req.headers['x-headlamp_backend-token'];
        return [200, mockResponse];
      });

    await clusterFetch(testUrl, { cluster: '' });

    expect(backendTokenHeader).toBeUndefined();
  });

  it('Sets KUBECONFIG and X-HEADLAMP-USER-ID headers if kubeconfig exists', async () => {
    nock(BASE_HTTP_URL)
      .get(`/clusters/${clusterName}${testUrl}`)
      .matchHeader('KUBECONFIG', kubeconfig)
      .matchHeader('X-HEADLAMP-USER-ID', userID)
      .matchHeader('X-HEADLAMP_BACKEND-TOKEN', 'desktop-token')
      .reply(200, mockResponse);

    await clusterFetch(testUrl, { cluster: clusterName });
  });

  it('preserves caller headers while adding the backend token', async () => {
    nock(BASE_HTTP_URL)
      .get(`/clusters/${clusterName}${testUrl}`)
      .matchHeader('X-CUSTOM-HEADER', 'caller-value')
      .matchHeader('X-HEADLAMP_BACKEND-TOKEN', 'desktop-token')
      .reply(200, mockResponse);

    await clusterFetch(testUrl, {
      cluster: clusterName,
      headers: { 'X-CUSTOM-HEADER': 'caller-value' },
    });
  });

  it('Throws an error if response is not ok', async () => {
    nock(BASE_HTTP_URL).get(`/clusters/${clusterName}${testUrl}`).reply(500);

    await expect(clusterFetch(testUrl, { cluster: clusterName })).rejects.toThrow('Unreachable');
  });
});

describe('clusterFetch — P1 #18 auth-expiry classification', () => {
  const clusterName = 'test-cluster';
  const testUrl = '/t';

  beforeEach(() => {
    vi.clearAllMocks();
    setBackendToken('desktop-token');
    (findKubeconfigByClusterName as Mock).mockResolvedValue(null);
    (getUserIdFromLocalStorage as Mock).mockReturnValue('u');
    (getClusterAuthType as Mock).mockReturnValue('serviceAccount');
  });
  afterEach(() => {
    setBackendToken(null);
    nock.cleanAll();
  });

  it('401 → reports auth failure once for the cluster', async () => {
    nock(BASE_HTTP_URL).get(`/clusters/${clusterName}${testUrl}`).reply(401);
    await expect(clusterFetch(testUrl, { cluster: clusterName })).rejects.toBeTruthy();
    expect(reportClusterAuthFailure).toHaveBeenCalledTimes(1);
    expect(reportClusterAuthFailure).toHaveBeenCalledWith(clusterName);
    expect(noteClusterAuthSuccess).not.toHaveBeenCalled();
  });

  it.each([403, 410, 429, 500])('%i → does NOT report auth failure', async code => {
    nock(BASE_HTTP_URL).get(`/clusters/${clusterName}${testUrl}`).reply(code);
    await expect(clusterFetch(testUrl, { cluster: clusterName })).rejects.toBeTruthy();
    expect(reportClusterAuthFailure).not.toHaveBeenCalled();
  });

  it('network failure → does NOT report auth failure', async () => {
    nock(BASE_HTTP_URL).get(`/clusters/${clusterName}${testUrl}`).replyWithError('boom');
    await expect(clusterFetch(testUrl, { cluster: clusterName })).rejects.toBeTruthy();
    expect(reportClusterAuthFailure).not.toHaveBeenCalled();
  });

  it('401 with autoLogoutOnAuthError:false → does NOT report (opt-out)', async () => {
    nock(BASE_HTTP_URL).get(`/clusters/${clusterName}${testUrl}`).reply(401);
    await expect(
      clusterFetch(testUrl, { cluster: clusterName, autoLogoutOnAuthError: false })
    ).rejects.toBeTruthy();
    expect(reportClusterAuthFailure).not.toHaveBeenCalled();
  });

  it('non-cluster (cluster:"") 401 → does NOT report', async () => {
    nock(BASE_HTTP_URL).get(testUrl).reply(401);
    await expect(clusterFetch(testUrl, { cluster: '' })).rejects.toBeTruthy();
    expect(reportClusterAuthFailure).not.toHaveBeenCalled();
  });

  it('success → notes auth success for the cluster (resets any episode)', async () => {
    nock(BASE_HTTP_URL).get(`/clusters/${clusterName}${testUrl}`).reply(200, { ok: true });
    await clusterFetch(testUrl, { cluster: clusterName });
    expect(noteClusterAuthSuccess).toHaveBeenCalledWith(clusterName);
    expect(reportClusterAuthFailure).not.toHaveBeenCalled();
  });
});
