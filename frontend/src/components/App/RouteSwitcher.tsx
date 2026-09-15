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

import { useQuery } from '@tanstack/react-query';
import React, { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch } from 'react-redux';
import { Redirect, Route, RouteProps, Switch, useHistory } from 'react-router-dom';
import { getCluster, getSelectedClusters } from '../../lib/cluster';
import { useCluster, useClustersConf } from '../../lib/k8s';
import { testAuth } from '../../lib/k8s/api/v1/clusterApi';
import {
  KEEP_LAST_GOOD,
  OPEN_GATE_RETRY,
  RETRY_BASE_DELAY_MS,
  STATUS_FAIL_THRESHOLD,
  withJitter,
} from '../../lib/resilience';
import { NotFoundRoute } from '../../lib/router';
import { createRouteURL } from '../../lib/router/createRouteURL';
import { getDefaultRoutes } from '../../lib/router/getDefaultRoutes';
import { getRoutePath } from '../../lib/router/getRoutePath';
import { getRouteUseClusterURL } from '../../lib/router/getRouteUseClusterURL';
import { Route as RouteType } from '../../lib/router/Route';
import { useTypedSelector } from '../../redux/hooks';
import { uiSlice } from '../../redux/uiSlice';
import ClusterAccessGate, { ClusterAccessGateState } from '../cluster/ClusterAccessGate';
import ReconnectingChip from '../cluster/ReconnectingChip';
import ErrorBoundary from '../common/ErrorBoundary';
import ErrorComponent from '../common/ErrorPage';
import { useSidebarItem } from '../Sidebar';

export default function RouteSwitcher(props: { requiresToken: () => boolean }) {
  // The NotFoundRoute always has to be evaluated in the last place.
  const routes = useTypedSelector(state => state.routes.routes);
  const routeFilters = useTypedSelector(state => state.routes.routeFilters);
  const defaultRoutes = Object.values(getDefaultRoutes()).concat(NotFoundRoute);
  const clusters = useClustersConf();
  const filteredRoutes = Object.values(routes)
    .concat(defaultRoutes)
    .filter(
      route =>
        !(
          routeFilters.length > 0 &&
          routeFilters.filter(f => f(route)).length !== routeFilters.length
        ) && !route.disabled
    );

  return (
    <Suspense fallback={null}>
      <Switch>
        {filteredRoutes.map((route, index) =>
          route.name === 'OidcAuth' ? (
            <Route
              path={route.path}
              component={() => <RouteComponent route={route} />}
              key={index}
            />
          ) : (
            <AuthRoute
              path={getRoutePath(route)}
              sidebar={route.sidebar}
              requiresAuth={!route.noAuthRequired}
              requiresCluster={getRouteUseClusterURL(route)}
              exact={!!route.exact}
              clusters={clusters}
              requiresToken={props.requiresToken}
              children={
                <RouteComponent route={route} key={`${getRoutePath(route)}-${getCluster()}`} />
              }
              key={`${getRoutePath(route)}-${getCluster()}`}
            />
          )
        )}
      </Switch>
    </Suspense>
  );
}

function RouteErrorBoundary(props: { error: Error; route: RouteType }) {
  const { error, route } = props;
  const { t } = useTranslation();
  return (
    <ErrorComponent
      title={t('Uh-oh! Something went wrong.')}
      error={error}
      message={t('translation|Error loading {{ routeName }}', { routeName: route.name })}
    />
  );
}

function RouteComponent({ route }: { route: RouteType }) {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  React.useEffect(() => {
    dispatch(uiSlice.actions.setHideAppBar(route.hideAppBar));
  }, [route.hideAppBar, dispatch]);

  React.useEffect(() => {
    dispatch(uiSlice.actions.setIsFullWidth(route.isFullWidth));
  }, [route.isFullWidth, dispatch]);

  return (
    <PageTitle
      title={t(
        route.name
          ? route.name
          : typeof route.sidebar === 'string'
          ? route.sidebar
          : route.sidebar?.item || ''
      )}
    >
      <ErrorBoundary
        fallback={(props: { error: Error }) => (
          <RouteErrorBoundary error={props.error} route={route} />
        )}
      >
        <route.component />
      </ErrorBoundary>
    </PageTitle>
  );
}

function PageTitle({
  title,
  children,
}: {
  title: string | null | undefined;
  children: React.ReactNode;
}) {
  const cluster = useCluster();

  React.useEffect(() => {
    if (cluster && title) {
      document.title = `${cluster} - ${title}`;
      return;
    }

    document.title = cluster || title || '';
  }, [cluster, title]);

  return <>{children}</>;
}

interface AuthRouteProps {
  children: React.ReactNode;
  sidebar: RouteType['sidebar'];
  requiresAuth: boolean;
  requiresCluster: boolean;
  requiresToken: () => boolean;
  [otherProps: string]: any;
}

// Exported for component testing of the P0 keep-last-good gate behaviour; not
// intended as a public API. Rendering/behaviour is unchanged by the export.
export function AuthRoute(props: AuthRouteProps) {
  const {
    children,
    sidebar,
    requiresAuth = true,
    requiresCluster = true,
    computedMatch = {},
    ...other
  } = props;

  useSidebarItem(sidebar, computedMatch);
  const history = useHistory();
  const cluster = useCluster();
  const query = useQuery({
    queryKey: ['auth', cluster],
    queryFn: () => testAuth(cluster!),
    enabled: !!cluster && requiresAuth,
    // P0: retry a transient open-check failure (jittered) instead of gating on
    // the first blip — but NEVER retry a genuine 401/403, which must surface
    // immediately. Configurable via REACT_APP_OPEN_GATE_RETRY.
    retry: (failureCount: number, error: any) => {
      if (error?.status === 401 || error?.status === 403) {
        return false;
      }
      return failureCount < OPEN_GATE_RETRY;
    },
    retryDelay: attempt => withJitter(RETRY_BASE_DELAY_MS * 2 ** attempt),
  });

  // P0 keep-last-good: track consecutive SETTLED errors for this mount so a single
  // blip after a prior success doesn't flip a working page to the gate. Reset on
  // any success. Bounded by STATUS_FAIL_THRESHOLD so a truly-down cluster still
  // gates (never an infinite "reconnecting").
  const authErrStreak = React.useRef(0);
  React.useEffect(() => {
    if (query.isSuccess) {
      authErrStreak.current = 0;
    } else if (query.isError) {
      authErrStreak.current += 1;
    }
  }, [query.status]);

  const clusters = useClustersConf();
  const currentCluster = getCluster();
  const clusterConf = currentCluster && clusters ? clusters[currentCluster] : null;
  const authError = query.error as any;
  const isExplicitAuthError = [401, 403].includes(authError?.status);

  // Once the cluster successfully accepts the token, clear the flag that marked
  // previous OIDC sign-in as rejected by the API server. See Issue #2848
  React.useEffect(() => {
    if (cluster && clusters?.[cluster]?.auth_type === 'oidc' && query.isSuccess) {
      try {
        sessionStorage.removeItem(`oidc-login-attempted.${cluster}`);
      } catch {
        // sessionStorage unavailable (e.g. private browsing with strict settings).
      }
    }
  }, [cluster, clusters, query.isSuccess]);

  let redirectRoute: string;

  if (!currentCluster) {
    redirectRoute = 'chooser';
  } else if (clusterConf?.auth_type === 'oidc') {
    redirectRoute = 'login';
  } else if (query.isError && isExplicitAuthError) {
    redirectRoute = 'token';
  } else {
    redirectRoute = 'login';
  }

  function getRenderer({ location }: RouteProps) {
    if (!requiresAuth) {
      return children;
    }

    if (requiresCluster) {
      if (getSelectedClusters().length > 1) {
        // In multi-cluster mode, we do not know if one of them requires a token.
        return children;
      }
    }

    if (query.isSuccess) {
      return children;
    }

    const goBack = () => history.push(createRouteURL('home'));

    if (query.isError) {
      // OIDC keeps its dedicated auto-redirect login flow, unchanged.
      if (clusterConf?.auth_type === 'oidc') {
        return (
          <Redirect
            to={{
              pathname: createRouteURL(redirectRoute),
              state: { from: location },
            }}
          />
        );
      }

      // Non-OIDC: instead of a jarring redirect to a generic auth screen, show the
      // centered access gate with a clear, translated message and a way forward.
      // The "Sign in again" action goes to the same route the redirect used, so
      // the underlying auth flow is unchanged — only the presentation improves.
      const status = authError?.status;

      // P0 keep-last-good: if this is a transient blip (not a real 401/403), we
      // already had a successful check (react-query keeps the last data even on a
      // failed background refetch, so query.data survives the return-to-tab
      // remount), and we haven't failed too many times in a row, keep the page up
      // with a subtle "reconnecting…" hint instead of throwing up the gate. A
      // genuine 401/403, or too many consecutive fails, still gates below.
      const isBlip = status !== 401 && status !== 403;
      const hadPriorSuccess = query.data !== undefined;
      if (
        KEEP_LAST_GOOD &&
        isBlip &&
        hadPriorSuccess &&
        authErrStreak.current < STATUS_FAIL_THRESHOLD
      ) {
        return (
          <>
            {children}
            <ReconnectingChip />
          </>
        );
      }

      const gateState: ClusterAccessGateState =
        status === 401 ? 'expired' : status === 403 ? 'forbidden' : 'unreachable';
      return (
        <ClusterAccessGate
          clusterName={cluster ?? ''}
          state={gateState}
          error={authError ?? null}
          onBack={goBack}
          onRetry={gateState === 'unreachable' ? () => query.refetch() : undefined}
          onSignIn={
            gateState === 'expired'
              ? () =>
                  history.push({
                    pathname: createRouteURL(redirectRoute),
                    state: { from: location },
                  })
              : undefined
          }
        />
      );
    }

    // Auth/status check still in flight (e.g. opened a cluster whose status
    // hadn't loaded yet, or a deep link / bookmark). Show the access gate in its
    // "checking" state and stay on it until the check resolves, instead of a
    // blank page. Once it resolves we render the cluster (success) or the gate's
    // error state / OIDC redirect (error) via the branches above.
    if (cluster && requiresAuth) {
      return <ClusterAccessGate clusterName={cluster} state="checking" onBack={goBack} />;
    }

    return null;
  }

  // If no auth is required for the view, or the token is set up, then
  // render the assigned component. Otherwise redirect to the login route.
  return <Route {...other} render={getRenderer} />;
}

const PreviousRouteContext = React.createContext<number>(0);

export function PreviousRouteProvider({ children }: React.PropsWithChildren<{}>) {
  const history = useHistory();
  const [locationInfo, setLocationInfo] = React.useState<number>(0);

  React.useEffect(() => {
    const unlisten = history.listen((location, action) => {
      if (action === 'PUSH') {
        setLocationInfo(levels => levels + 1);
      } else if (action === 'POP') {
        setLocationInfo(levels => levels - 1);
      }
    });
    return unlisten;
  }, [history]);

  return (
    <PreviousRouteContext.Provider value={locationInfo}>{children}</PreviousRouteContext.Provider>
  );
}

export function useHasPreviousRoute() {
  const routeLevels = React.useContext(PreviousRouteContext);
  return routeLevels >= 1;
}
