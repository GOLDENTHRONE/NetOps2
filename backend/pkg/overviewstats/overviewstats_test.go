// Copyright 2025 The Kubernetes Authors.
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//	http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package overviewstats

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/kubernetes-sigs/headlamp/backend/pkg/kubeconfig"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime"
	"k8s.io/apimachinery/pkg/runtime/schema"
	dynamicfake "k8s.io/client-go/dynamic/fake"
)

// --- Helper factories ---

func newPod(name, namespace, phase string, readyCondition bool) *unstructured.Unstructured {
	conditions := []interface{}{}
	if readyCondition {
		conditions = append(conditions, map[string]interface{}{
			"type":   "Ready",
			"status": "True",
		})
	} else {
		conditions = append(conditions, map[string]interface{}{
			"type":   "Ready",
			"status": "False",
		})
	}

	return &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "v1",
			"kind":       "Pod",
			"metadata": map[string]interface{}{
				"name":      name,
				"namespace": namespace,
				"uid":       name + "-uid",
			},
			"status": map[string]interface{}{
				"phase":      phase,
				"conditions": conditions,
			},
		},
	}
}

func newNode(name string, ready bool) *unstructured.Unstructured {
	status := "False"
	if ready {
		status = "True"
	}

	return &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "v1",
			"kind":       "Node",
			"metadata": map[string]interface{}{
				"name": name,
				"uid":  name + "-uid",
			},
			"status": map[string]interface{}{
				"conditions": []interface{}{
					map[string]interface{}{
						"type":   "Ready",
						"status": status,
					},
				},
			},
		},
	}
}

func newDeployment(name, namespace string, replicas, available int64) *unstructured.Unstructured {
	return &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "apps/v1",
			"kind":       "Deployment",
			"metadata": map[string]interface{}{
				"name":      name,
				"namespace": namespace,
				"uid":       name + "-uid",
			},
			"spec": map[string]interface{}{
				"replicas": replicas,
			},
			"status": map[string]interface{}{
				"availableReplicas": available,
			},
		},
	}
}

// newNodeWithCapacity is like newNode but also sets status.capacity.
func newNodeWithCapacity(name string, ready bool, cpu, mem string) *unstructured.Unstructured {
	n := newNode(name, ready)
	status, _ := n.Object["status"].(map[string]interface{})
	status["capacity"] = map[string]interface{}{
		"cpu":    cpu,
		"memory": mem,
	}

	return n
}

// newNodeMetrics builds a metrics.k8s.io node usage object. The kind is set so
// the fake dynamic client's kind->resource guesser maps it to the "nodes"
// resource under the metrics.k8s.io group (matching the real aggregated API).
func newNodeMetrics(name, cpu, mem string) *unstructured.Unstructured {
	return &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "metrics.k8s.io/v1beta1",
			"kind":       "Node",
			"metadata": map[string]interface{}{
				"name": name,
			},
			"usage": map[string]interface{}{
				"cpu":    cpu,
				"memory": mem,
			},
		},
	}
}

// --- Unit tests for status helpers ---

func TestIsPodReady(t *testing.T) {
	tests := []struct {
		name     string
		pod      *unstructured.Unstructured
		expected bool
	}{
		{
			name:     "pod with Ready=True condition",
			pod:      newPod("p1", "default", "Running", true),
			expected: true,
		},
		{
			name:     "pod with Succeeded phase",
			pod:      newPod("p2", "default", "Succeeded", false),
			expected: true,
		},
		{
			name:     "pod with Ready=False condition and Running phase",
			pod:      newPod("p3", "default", "Running", false),
			expected: false,
		},
		{
			name:     "pod with Pending phase and no ready condition",
			pod:      newPod("p4", "default", "Pending", false),
			expected: false,
		},
		{
			name:     "pod with Failed phase",
			pod:      newPod("p5", "default", "Failed", false),
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isPodReady(tt.pod)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestIsNodeReady(t *testing.T) {
	tests := []struct {
		name     string
		node     *unstructured.Unstructured
		expected bool
	}{
		{
			name:     "node with Ready=True",
			node:     newNode("n1", true),
			expected: true,
		},
		{
			name:     "node with Ready=False",
			node:     newNode("n2", false),
			expected: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := isNodeReady(tt.node)
			assert.Equal(t, tt.expected, result)
		})
	}
}

func TestGetDeploymentCounts(t *testing.T) {
	tests := []struct {
		name              string
		deploy            *unstructured.Unstructured
		expectedAvailable int
		expectedDesired   int
	}{
		{
			name:              "fully available",
			deploy:            newDeployment("d1", "default", 3, 3),
			expectedAvailable: 3,
			expectedDesired:   3,
		},
		{
			name:              "partially available",
			deploy:            newDeployment("d2", "default", 5, 3),
			expectedAvailable: 3,
			expectedDesired:   5,
		},
		{
			name:              "zero replicas",
			deploy:            newDeployment("d3", "default", 0, 0),
			expectedAvailable: 0,
			expectedDesired:   0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			available, desired := getDeploymentCounts(tt.deploy)
			assert.Equal(t, tt.expectedAvailable, available)
			assert.Equal(t, tt.expectedDesired, desired)
		})
	}
}

// --- Transform function tests ---

func TestPodTransform(t *testing.T) {
	fullPod := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "v1",
			"kind":       "Pod",
			"metadata": map[string]interface{}{
				"name":      "test-pod",
				"namespace": "default",
				"uid":       "abc-123",
				"labels":    map[string]interface{}{"app": "test"},
				"annotations": map[string]interface{}{
					"kubectl.kubernetes.io/last-applied-configuration": "very long string...",
				},
			},
			"spec": map[string]interface{}{
				"containers": []interface{}{
					map[string]interface{}{
						"name":  "nginx",
						"image": "nginx:latest",
						"ports": []interface{}{
							map[string]interface{}{"containerPort": int64(80)},
						},
					},
				},
				"volumes": []interface{}{
					map[string]interface{}{"name": "data"},
				},
			},
			"status": map[string]interface{}{
				"phase": "Running",
				"conditions": []interface{}{
					map[string]interface{}{"type": "Ready", "status": "True"},
				},
				"containerStatuses": []interface{}{
					map[string]interface{}{"name": "nginx", "ready": true},
				},
			},
		},
	}

	result, err := podTransform(fullPod)
	require.NoError(t, err)

	stripped, ok := result.(*unstructured.Unstructured)
	require.True(t, ok)

	// Verify essential fields preserved.
	assert.Equal(t, "test-pod", stripped.GetName())
	assert.Equal(t, "default", stripped.GetNamespace())

	phase, _, _ := unstructured.NestedString(stripped.Object, "status", "phase")
	assert.Equal(t, "Running", phase)

	conditions, _, _ := unstructured.NestedSlice(stripped.Object, "status", "conditions")
	assert.Len(t, conditions, 1)

	// Verify bloat fields are gone.
	_, specExists, _ := unstructured.NestedMap(stripped.Object, "spec")
	assert.False(t, specExists, "spec should be stripped")

	_, labelsExists, _ := unstructured.NestedMap(stripped.Object, "metadata", "labels")
	assert.False(t, labelsExists, "labels should be stripped")

	_, containerStatusExists, _ := unstructured.NestedSlice(stripped.Object, "status", "containerStatuses")
	assert.Empty(t, containerStatusExists, "containerStatuses should be stripped")
}

func TestNodeTransform(t *testing.T) {
	fullNode := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "v1",
			"kind":       "Node",
			"metadata": map[string]interface{}{
				"name":   "worker-01",
				"uid":    "node-uid-1",
				"labels": map[string]interface{}{"kubernetes.io/os": "linux"},
			},
			"spec": map[string]interface{}{
				"podCIDR": "10.0.0.0/24",
			},
			"status": map[string]interface{}{
				"conditions": []interface{}{
					map[string]interface{}{"type": "Ready", "status": "True"},
					map[string]interface{}{"type": "MemoryPressure", "status": "False"},
				},
				"addresses": []interface{}{
					map[string]interface{}{"type": "InternalIP", "address": "10.0.0.1"},
				},
				"capacity": map[string]interface{}{
					"cpu":    "4",
					"memory": "16Gi",
				},
			},
		},
	}

	result, err := nodeTransform(fullNode)
	require.NoError(t, err)

	stripped, ok := result.(*unstructured.Unstructured)
	require.True(t, ok)

	assert.Equal(t, "worker-01", stripped.GetName())

	conditions, _, _ := unstructured.NestedSlice(stripped.Object, "status", "conditions")
	assert.Len(t, conditions, 2)

	// Verify bloat removed.
	_, specExists, _ := unstructured.NestedMap(stripped.Object, "spec")
	assert.False(t, specExists)

	_, addrExists, _ := unstructured.NestedSlice(stripped.Object, "status", "addresses")
	assert.Empty(t, addrExists)
}

func TestDeployTransform(t *testing.T) {
	fullDeploy := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": "apps/v1",
			"kind":       "Deployment",
			"metadata": map[string]interface{}{
				"name":      "my-app",
				"namespace": "production",
				"uid":       "deploy-uid-1",
			},
			"spec": map[string]interface{}{
				"replicas": int64(5),
				"selector": map[string]interface{}{
					"matchLabels": map[string]interface{}{"app": "my-app"},
				},
				"template": map[string]interface{}{
					"spec": map[string]interface{}{
						"containers": []interface{}{
							map[string]interface{}{"name": "app", "image": "app:v2"},
						},
					},
				},
			},
			"status": map[string]interface{}{
				"availableReplicas": int64(4),
				"replicas":          int64(5),
				"updatedReplicas":   int64(5),
				"conditions": []interface{}{
					map[string]interface{}{"type": "Available", "status": "True"},
				},
			},
		},
	}

	result, err := deployTransform(fullDeploy)
	require.NoError(t, err)

	stripped, ok := result.(*unstructured.Unstructured)
	require.True(t, ok)

	replicas, _, _ := unstructured.NestedInt64(stripped.Object, "spec", "replicas")
	assert.Equal(t, int64(5), replicas)

	available, _, _ := unstructured.NestedInt64(stripped.Object, "status", "availableReplicas")
	assert.Equal(t, int64(4), available)

	// Verify template and other bloat removed.
	_, templateExists, _ := unstructured.NestedMap(stripped.Object, "spec", "template")
	assert.False(t, templateExists)

	_, conditionsExists, _ := unstructured.NestedSlice(stripped.Object, "status", "conditions")
	assert.Empty(t, conditionsExists)
}

// --- Integration tests with fake dynamic client ---

func TestManagerWithFakeInformers(t *testing.T) {
	scheme := runtime.NewScheme()

	pods := []runtime.Object{
		newPod("pod-1", "default", "Running", true),
		newPod("pod-2", "default", "Running", true),
		newPod("pod-3", "default", "Pending", false),
		newPod("pod-4", "kube-system", "Running", true),
		newPod("pod-5", "kube-system", "Failed", false),
	}

	nodes := []runtime.Object{
		newNode("node-1", true),
		newNode("node-2", true),
		newNode("node-3", false),
	}

	deploys := []runtime.Object{
		newDeployment("deploy-1", "default", 3, 3),
		newDeployment("deploy-2", "default", 5, 4),
		newDeployment("deploy-3", "kube-system", 2, 2),
	}

	allObjects := append(append(pods, nodes...), deploys...)
	client := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme,
		map[schema.GroupVersionResource]string{
			{Group: "", Version: "v1", Resource: "pods"}:                     "PodList",
			{Group: "", Version: "v1", Resource: "nodes"}:                    "NodeList",
			{Group: "apps", Version: "v1", Resource: "deployments"}:          "DeploymentList",
			{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "nodes"}: "NodeMetricsList",
		},
		allObjects...,
	)

	mgr := NewManager()
	defer mgr.StopAll()

	w := &clusterWatcher{}
	mgr.mu.Lock()
	mgr.watchers["test-cluster"] = w
	mgr.mu.Unlock()

	// Run watcher synchronously for test.
	ctx, cancel := context.WithCancel(context.Background())
	w.cancel = cancel
	defer cancel()

	go mgr.runWatcher(ctx, "test-cluster", client, w)

	// Wait for sync.
	require.Eventually(t, func() bool {
		w.mu.RLock()
		defer w.mu.RUnlock()
		return w.synced
	}, 5*time.Second, 50*time.Millisecond)

	stats, err := mgr.GetStats("test-cluster")
	require.NoError(t, err)
	assert.True(t, stats.Synced)

	// Pods: pod-1(ready), pod-2(ready), pod-3(not ready), pod-4(ready), pod-5(failed, not ready)
	assert.Equal(t, 5, stats.Pods.Total)
	assert.Equal(t, 3, stats.Pods.Ready)

	// Nodes: node-1(ready), node-2(ready), node-3(not ready)
	assert.Equal(t, 3, stats.Nodes.Total)
	assert.Equal(t, 2, stats.Nodes.Ready)

	// Deployments: deploy-1(3/3), deploy-2(4/5), deploy-3(2/2) = 9 available, 10 desired
	assert.Equal(t, 9, stats.Deployments.Available)
	assert.Equal(t, 10, stats.Deployments.Desired)
}

// TestMetricsAggregation verifies CPU/memory usage (metrics.k8s.io) and capacity
// (node informer store) are summed into a single snapshot.
func TestMetricsAggregation(t *testing.T) {
	scheme := runtime.NewScheme()

	nodes := []runtime.Object{
		newNodeWithCapacity("node-1", true, "4", "8Gi"),
		newNodeWithCapacity("node-2", true, "4", "8Gi"),
	}

	metrics := []runtime.Object{
		newNodeMetrics("node-1", "500m", "1Gi"),
		newNodeMetrics("node-2", "500m", "1Gi"),
	}

	allObjects := append(nodes, metrics...)
	client := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme,
		map[schema.GroupVersionResource]string{
			{Group: "", Version: "v1", Resource: "pods"}:                     "PodList",
			{Group: "", Version: "v1", Resource: "nodes"}:                    "NodeList",
			{Group: "apps", Version: "v1", Resource: "deployments"}:          "DeploymentList",
			{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "nodes"}: "NodeMetricsList",
		},
		allObjects...,
	)

	mgr := NewManager()
	defer mgr.StopAll()

	w := &clusterWatcher{}
	mgr.mu.Lock()
	mgr.watchers["test-metrics"] = w
	mgr.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	w.cancel = cancel
	defer cancel()

	go mgr.runWatcher(ctx, "test-metrics", client, w)

	// Wait until the async metrics poll has populated the snapshot.
	require.Eventually(t, func() bool {
		s, _ := mgr.GetStats("test-metrics")
		return s.MetricsAvailable && s.CPU.Capacity > 0
	}, 5*time.Second, 50*time.Millisecond)

	stats, err := mgr.GetStats("test-metrics")
	require.NoError(t, err)

	assert.True(t, stats.MetricsAvailable)

	// Capacity: 2 nodes x 4 cores = 8 cores = 8e9 nanocores.
	assert.Equal(t, int64(8_000_000_000), stats.CPU.Capacity)
	// Usage: 2 x 500m = 1 core = 1e9 nanocores.
	assert.Equal(t, int64(1_000_000_000), stats.CPU.Used)

	// Capacity: 2 nodes x 8Gi = 16Gi bytes.
	assert.Equal(t, int64(16)*1024*1024*1024, stats.Memory.Capacity)
	// Usage: 2 x 1Gi = 2Gi bytes.
	assert.Equal(t, int64(2)*1024*1024*1024, stats.Memory.Used)
}

// --- Test add/update/delete events ---

func TestPodAddUpdateDelete(t *testing.T) {
	scheme := runtime.NewScheme()

	// Start with 2 ready pods.
	pods := []runtime.Object{
		newPod("pod-1", "default", "Running", true),
		newPod("pod-2", "default", "Running", true),
	}

	client := dynamicfake.NewSimpleDynamicClientWithCustomListKinds(scheme,
		map[schema.GroupVersionResource]string{
			{Group: "", Version: "v1", Resource: "pods"}:                     "PodList",
			{Group: "", Version: "v1", Resource: "nodes"}:                    "NodeList",
			{Group: "apps", Version: "v1", Resource: "deployments"}:          "DeploymentList",
			{Group: "metrics.k8s.io", Version: "v1beta1", Resource: "nodes"}: "NodeMetricsList",
		},
		pods...,
	)

	mgr := NewManager()
	defer mgr.StopAll()

	w := &clusterWatcher{}
	mgr.mu.Lock()
	mgr.watchers["test"] = w
	mgr.mu.Unlock()

	ctx, cancel := context.WithCancel(context.Background())
	w.cancel = cancel
	defer cancel()

	go mgr.runWatcher(ctx, "test", client, w)

	require.Eventually(t, func() bool {
		w.mu.RLock()
		defer w.mu.RUnlock()
		return w.synced
	}, 5*time.Second, 50*time.Millisecond)

	// Verify initial state.
	stats, _ := mgr.GetStats("test")
	assert.Equal(t, 2, stats.Pods.Total)
	assert.Equal(t, 2, stats.Pods.Ready)

	// Simulate ADD: create a new not-ready pod.
	podGVR := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}
	newPodObj := newPod("pod-3", "default", "Pending", false)
	_, err := client.Resource(podGVR).Namespace("default").Create(ctx, newPodObj, metav1.CreateOptions{})
	require.NoError(t, err)

	// Wait for informer to process the event.
	require.Eventually(t, func() bool {
		s, _ := mgr.GetStats("test")
		return s.Pods.Total == 3
	}, 5*time.Second, 50*time.Millisecond)

	stats, _ = mgr.GetStats("test")
	assert.Equal(t, 3, stats.Pods.Total)
	assert.Equal(t, 2, stats.Pods.Ready)

	// Simulate UPDATE: pod-3 becomes ready.
	readyPod := newPod("pod-3", "default", "Running", true)
	_, err = client.Resource(podGVR).Namespace("default").Update(ctx, readyPod, metav1.UpdateOptions{})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		s, _ := mgr.GetStats("test")
		return s.Pods.Ready == 3
	}, 5*time.Second, 50*time.Millisecond)

	stats, _ = mgr.GetStats("test")
	assert.Equal(t, 3, stats.Pods.Total)
	assert.Equal(t, 3, stats.Pods.Ready)

	// Simulate DELETE: remove pod-1.
	err = client.Resource(podGVR).Namespace("default").Delete(ctx, "pod-1", metav1.DeleteOptions{})
	require.NoError(t, err)

	require.Eventually(t, func() bool {
		s, _ := mgr.GetStats("test")
		return s.Pods.Total == 2
	}, 5*time.Second, 50*time.Millisecond)

	stats, _ = mgr.GetStats("test")
	assert.Equal(t, 2, stats.Pods.Total)
	assert.Equal(t, 2, stats.Pods.Ready)
}

// --- HTTP handler tests ---

func TestHandleOverviewStats_NoCluster(t *testing.T) {
	mgr := NewManager()

	// Override muxVars for testing.
	origMuxVars := muxVars
	defer func() { muxVars = origMuxVars }()
	muxVars = func(r *http.Request) map[string]string {
		return map[string]string{"clusterName": ""}
	}

	handler := HandleOverviewStats(mgr, nil)
	req := httptest.NewRequest("GET", "/clusters//overview-stats", nil)
	rr := httptest.NewRecorder()

	handler(rr, req)

	assert.Equal(t, http.StatusBadRequest, rr.Code)
}

func TestHandleOverviewStats_ClusterNotFound(t *testing.T) {
	mgr := NewManager()

	origMuxVars := muxVars
	defer func() { muxVars = origMuxVars }()
	muxVars = func(r *http.Request) map[string]string {
		return map[string]string{"clusterName": "nonexistent"}
	}

	store := &fakeContextStore{contexts: map[string]*kubeconfig.Context{}}
	handler := HandleOverviewStats(mgr, store)
	req := httptest.NewRequest("GET", "/clusters/nonexistent/overview-stats", nil)
	rr := httptest.NewRecorder()

	handler(rr, req)

	assert.Equal(t, http.StatusNotFound, rr.Code)
}

func TestHandleOverviewStats_Success(t *testing.T) {
	mgr := NewManager()

	// Pre-populate stats with a non-nil cancel so StartWatcher short-circuits.
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	w := &clusterWatcher{
		cancel: cancel,
		synced: true,
		stats: Stats{
			Pods:        ResourceCount{Ready: 100, Total: 105},
			Nodes:       ResourceCount{Ready: 10, Total: 10},
			Deployments: DeploymentCount{Available: 50, Desired: 55},
			LastUpdated: time.Now(),
		},
	}
	mgr.mu.Lock()
	mgr.watchers["my-cluster"] = w
	mgr.mu.Unlock()

	origMuxVars := muxVars
	defer func() { muxVars = origMuxVars }()
	muxVars = func(r *http.Request) map[string]string {
		return map[string]string{"clusterName": "my-cluster"}
	}

	store := &fakeContextStore{contexts: map[string]*kubeconfig.Context{
		"my-cluster": {},
	}}
	handler := HandleOverviewStats(mgr, store)
	req := httptest.NewRequest("GET", "/clusters/my-cluster/overview-stats", nil)
	rr := httptest.NewRecorder()

	handler(rr, req)

	assert.Equal(t, http.StatusOK, rr.Code)
	assert.Equal(t, "synced", rr.Header().Get("X-Data-Status"))
	assert.Equal(t, "application/json", rr.Header().Get("Content-Type"))

	var stats Stats
	err := json.NewDecoder(rr.Body).Decode(&stats)
	require.NoError(t, err)

	assert.Equal(t, 100, stats.Pods.Ready)
	assert.Equal(t, 105, stats.Pods.Total)
	assert.Equal(t, 10, stats.Nodes.Ready)
	assert.Equal(t, 10, stats.Nodes.Total)
	assert.Equal(t, 50, stats.Deployments.Available)
	assert.Equal(t, 55, stats.Deployments.Desired)
	assert.True(t, stats.Synced)
}

func TestHandleOverviewStats_NotYetSynced(t *testing.T) {
	mgr := NewManager()

	// Watcher exists but not synced — give non-nil cancel so StartWatcher short-circuits.
	_, cancel := context.WithCancel(context.Background())
	defer cancel()

	w := &clusterWatcher{
		cancel: cancel,
		synced: false,
		stats:  Stats{},
	}
	mgr.mu.Lock()
	mgr.watchers["my-cluster"] = w
	mgr.mu.Unlock()

	origMuxVars := muxVars
	defer func() { muxVars = origMuxVars }()
	muxVars = func(r *http.Request) map[string]string {
		return map[string]string{"clusterName": "my-cluster"}
	}

	store := &fakeContextStore{contexts: map[string]*kubeconfig.Context{
		"my-cluster": {},
	}}
	handler := HandleOverviewStats(mgr, store)
	req := httptest.NewRequest("GET", "/clusters/my-cluster/overview-stats", nil)
	rr := httptest.NewRecorder()

	handler(rr, req)

	assert.Equal(t, http.StatusAccepted, rr.Code)
	assert.Equal(t, "syncing", rr.Header().Get("X-Data-Status"))
}

// --- Manager lifecycle tests ---

func TestManagerStopWatcher(t *testing.T) {
	mgr := NewManager()

	ctx, cancel := context.WithCancel(context.Background())
	w := &clusterWatcher{cancel: cancel}
	mgr.mu.Lock()
	mgr.watchers["test"] = w
	mgr.mu.Unlock()

	_ = ctx // keep ctx referenced

	mgr.StopWatcher("test")

	mgr.mu.RLock()
	_, exists := mgr.watchers["test"]
	mgr.mu.RUnlock()

	assert.False(t, exists)
}

func TestManagerStopAll(t *testing.T) {
	mgr := NewManager()

	_, cancel1 := context.WithCancel(context.Background())
	_, cancel2 := context.WithCancel(context.Background())

	mgr.mu.Lock()
	mgr.watchers["c1"] = &clusterWatcher{cancel: cancel1}
	mgr.watchers["c2"] = &clusterWatcher{cancel: cancel2}
	mgr.mu.Unlock()

	mgr.StopAll()

	mgr.mu.RLock()
	assert.Empty(t, mgr.watchers)
	mgr.mu.RUnlock()
}

func TestGetStats_NoWatcher(t *testing.T) {
	mgr := NewManager()

	_, err := mgr.GetStats("nonexistent")
	assert.Error(t, err)
	assert.Contains(t, err.Error(), "no watcher")
}

// --- Fake ContextStore for handler tests ---

type fakeContextStore struct {
	contexts map[string]*kubeconfig.Context
}

func (f *fakeContextStore) GetContext(name string) (*kubeconfig.Context, error) {
	ctx, ok := f.contexts[name]
	if !ok {
		return nil, fmt.Errorf("not found")
	}
	return ctx, nil
}

func (f *fakeContextStore) GetContexts() ([]*kubeconfig.Context, error) {
	return nil, nil
}

func (f *fakeContextStore) GetContextKeys() ([]string, error) {
	return nil, nil
}

func (f *fakeContextStore) AddContext(_ *kubeconfig.Context) error {
	return nil
}

func (f *fakeContextStore) RemoveContext(_ string) error {
	return nil
}

func (f *fakeContextStore) AddContextWithKeyAndTTL(_ *kubeconfig.Context, _ string, _ time.Duration) error {
	return nil
}

func (f *fakeContextStore) UpdateTTL(_ string, _ time.Duration) error {
	return nil
}

func (f *fakeContextStore) AddListener(_ kubeconfig.ContextChangeListener) {}
