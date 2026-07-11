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

import homeTabsReducer, { HomeTab, setHomeTab } from './homeTabsSlice';

describe('homeTabsSlice', () => {
  const makeTab = (id: string, label = id): HomeTab => ({
    id,
    label,
    icon: 'mdi:sync-circle',
    component: () => null,
  });

  it('adds a tab', () => {
    const state = homeTabsReducer(undefined, setHomeTab(makeTab('flux', 'Flux')));
    expect(Object.keys(state.tabs)).toEqual(['flux']);
    expect(state.tabs.flux.label).toBe('Flux');
  });

  it('replaces a tab with the same id', () => {
    let state = homeTabsReducer(undefined, setHomeTab(makeTab('flux', 'Flux')));
    state = homeTabsReducer(state, setHomeTab(makeTab('flux', 'Flux v2')));
    expect(Object.keys(state.tabs)).toEqual(['flux']);
    expect(state.tabs.flux.label).toBe('Flux v2');
  });

  it('keeps tabs with different ids', () => {
    let state = homeTabsReducer(undefined, setHomeTab(makeTab('flux')));
    state = homeTabsReducer(state, setHomeTab(makeTab('argo')));
    expect(Object.keys(state.tabs).sort()).toEqual(['argo', 'flux']);
  });
});
