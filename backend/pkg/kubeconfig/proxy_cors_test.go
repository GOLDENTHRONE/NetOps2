/*
Copyright 2025 The Kubernetes Authors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

package kubeconfig_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gorilla/handlers"
	"github.com/kubernetes-sigs/headlamp/backend/pkg/kubeconfig"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"k8s.io/client-go/tools/clientcmd/api"
)

const testOrigin = "http://localhost:3000"

// corsMiddleware mirrors the dev-mode CORS middleware used in cmd/headlamp.go.
func corsMiddleware(next http.Handler) http.Handler {
	return handlers.CORS(
		handlers.AllowedHeaders([]string{"Content-Type", "Authorization"}),
		handlers.AllowedMethods([]string{"GET", "POST", "OPTIONS"}),
		handlers.AllowCredentials(),
		handlers.AllowedOriginValidator(func(string) bool { return true }),
	)(next)
}

func proxyThroughCORS(t *testing.T, oidc bool, upstream func(w http.ResponseWriter, r *http.Request)) *http.Response {
	t.Helper()

	upstreamServer := httptest.NewServer(http.HandlerFunc(upstream))
	t.Cleanup(upstreamServer.Close)

	kContext := &kubeconfig.Context{
		Name:    "test-context",
		Cluster: &api.Cluster{Server: upstreamServer.URL},
	}
	if oidc {
		kContext.OidcConf = &kubeconfig.OidcConfig{}
	}

	handler := corsMiddleware(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.NoError(t, kContext.ProxyRequest(w, r))
	}))

	req := httptest.NewRequestWithContext(context.Background(), http.MethodGet, "/version", nil)
	req.Header.Set("Origin", testOrigin)

	rr := httptest.NewRecorder()
	handler.ServeHTTP(rr, req)

	return rr.Result()
}

// TestProxyDoesNotDuplicateCORSHeaders makes sure the browser never receives more
// than one Access-Control-Allow-Origin value, regardless of what upstream sends.
func TestProxyDoesNotDuplicateCORSHeaders(t *testing.T) {
	tests := []struct {
		name     string
		oidc     bool
		upstream func(w http.ResponseWriter, r *http.Request)
	}{
		{
			name: "non-OIDC upstream sends CORS headers",
			upstream: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Set("Access-Control-Allow-Origin", testOrigin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Expose-Headers", "X-Upstream")
				w.WriteHeader(http.StatusOK)
			},
		},
		{
			name: "OIDC upstream sends CORS headers",
			oidc: true,
			upstream: func(w http.ResponseWriter, _ *http.Request) {
				w.Header().Add("Access-Control-Allow-Origin", "https://upstream.example.com")
				w.Header().Add("Access-Control-Allow-Origin", testOrigin)
				w.Header().Set("Access-Control-Allow-Credentials", "true")
				w.Header().Set("Access-Control-Expose-Headers", "X-Upstream")
				w.WriteHeader(http.StatusOK)
			},
		},
		{
			name: "upstream sends no CORS headers",
			upstream: func(w http.ResponseWriter, _ *http.Request) {
				w.WriteHeader(http.StatusOK)
			},
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			resp := proxyThroughCORS(t, tc.oidc, tc.upstream)
			defer func() {
				require.NoError(t, resp.Body.Close())
			}()

			allowOrigin := resp.Header.Values("Access-Control-Allow-Origin")

			assert.Len(t, allowOrigin, 1)
			assert.Equal(t, testOrigin, allowOrigin[0])
			assert.NotContains(t, allowOrigin[0], ",")
		})
	}
}

func TestOIDCProxy401DoesNotDuplicateCORSHeaders(t *testing.T) {
	resp := proxyThroughCORS(t, true, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "https://upstream.example.com")
		w.WriteHeader(http.StatusUnauthorized)
	})
	defer func() {
		require.NoError(t, resp.Body.Close())
	}()

	assert.Equal(t, http.StatusUnauthorized, resp.StatusCode)
	assert.Equal(t, []string{testOrigin}, resp.Header.Values("Access-Control-Allow-Origin"))
}

// TestProxyKeepsNonCORSHeaders checks that stripping upstream CORS headers does not
// drop unrelated headers, and that only the "Origin" token is removed from "Vary".
func TestProxyKeepsNonCORSHeaders(t *testing.T) {
	resp := proxyThroughCORS(t, false, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", testOrigin)
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Custom", "keep-me")
		w.Header().Set("Vary", "Origin, Accept-Encoding")
		w.WriteHeader(http.StatusOK)
	})
	defer func() {
		require.NoError(t, resp.Body.Close())
	}()

	assert.Len(t, resp.Header.Values("Access-Control-Allow-Origin"), 1)
	assert.Equal(t, "application/json", resp.Header.Get("Content-Type"))
	assert.Equal(t, "keep-me", resp.Header.Get("X-Custom"))

	vary := resp.Header.Values("Vary")
	assert.Contains(t, vary, "Accept-Encoding")
	assert.NotContains(t, vary, "Origin")
}

// TestProxyDropsVaryWhenOnlyOrigin removes the header entirely when "Origin" was its
// only value, so no empty "Vary" is sent.
func TestProxyDropsVaryWhenOnlyOrigin(t *testing.T) {
	resp := proxyThroughCORS(t, false, func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", testOrigin)
		w.Header().Set("Vary", "Origin")
		w.WriteHeader(http.StatusOK)
	})
	defer func() {
		require.NoError(t, resp.Body.Close())
	}()

	assert.Len(t, resp.Header.Values("Access-Control-Allow-Origin"), 1)
	assert.Empty(t, resp.Header.Values("Vary"))
}
