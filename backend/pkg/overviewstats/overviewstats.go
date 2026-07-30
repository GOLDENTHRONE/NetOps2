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

// Package overviewstats provides real-time aggregated resource counts for the
// Overview dashboard. It uses SharedInformers with transform functions to maintain
// lightweight in-memory counters, avoiding expensive full-list API calls from the
// frontend when clusters have thousands of resources.
package overviewstats

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/mux"
	"github.com/kubernetes-sigs/headlamp/backend/pkg/kubeconfig"
	"github.com/kubernetes-sigs/headlamp/backend/pkg/logger"
	"k8s.io/apimachinery/pkg/api/resource"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/apimachinery/pkg/apis/meta/v1/unstructured"
	"k8s.io/apimachinery/pkg/runtime/schema"
	"k8s.io/client-go/dynamic"
	"k8s.io/client-go/dynamic/dynamicinformer"
	"k8s.io/client-go/tools/cache"
)

// Stats holds the aggregated resource counts for a cluster.
type Stats struct {
	Pods        ResourceCount   `json:"pods"`
	Nodes       ResourceCount   `json:"nodes"`
	Deployments DeploymentCount `json:"deployments"`
	// CPU aggregate across all nodes, in nanocores (used vs capacity).
	CPU ResourceUsage `json:"cpu"`
	// Memory aggregate across all nodes, in bytes (used vs capacity).
	Memory ResourceUsage `json:"memory"`
	// MetricsAvailable is false when the cluster has no metrics-server
	// (metrics.k8s.io unavailable); CPU/Memory Used is then meaningless.
	MetricsAvailable bool      `json:"metricsAvailable"`
	Synced           bool      `json:"synced"`
	LastUpdated      time.Time `json:"lastUpdated"`
}

// ResourceCount tracks ready vs total for pods/nodes.
type ResourceCount struct {
	Ready int `json:"ready"`
	Total int `json:"total"`
}

// ResourceUsage tracks used vs capacity for CPU (nanocores) or Memory (bytes).
type ResourceUsage struct {
	Used     int64 `json:"used"`
	Capacity int64 `json:"capacity"`
}

// DeploymentCount tracks available vs desired replicas.
type DeploymentCount struct {
	Available int `json:"available"`
	Desired   int `json:"desired"`
}

// clusterWatcher holds the informer state for one cluster.
type clusterWatcher struct {
	mu       sync.RWMutex
	cancel   context.CancelFunc
	stats    Stats
	synced   bool
	startErr error
}

// Manager manages overview stats watchers for all clusters.
type Manager struct {
	mu       sync.RWMutex
	watchers map[string]*clusterWatcher
}

// NewManager creates a new overview stats manager.
func NewManager() *Manager {
	return &Manager{
		watchers: make(map[string]*clusterWatcher),
	}
}

// StartWatcher begins watching a cluster's resources for overview stats.
// It is safe to call multiple times for the same cluster (idempotent).
func (m *Manager) StartWatcher(clusterName string, kContext *kubeconfig.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Already running
	if w, exists := m.watchers[clusterName]; exists && w.cancel != nil {
		return nil
	}

	config, err := kContext.RESTConfig()
	if err != nil {
		return fmt.Errorf("getting REST config for cluster %s: %w", clusterName, err)
	}

	dynamicClient, err := dynamic.NewForConfig(config)
	if err != nil {
		return fmt.Errorf("creating dynamic client for cluster %s: %w", clusterName, err)
	}

	ctx, cancel := context.WithCancel(context.Background())
	w := &clusterWatcher{
		cancel: cancel,
	}
	m.watchers[clusterName] = w

	go m.runWatcher(ctx, clusterName, dynamicClient, w)

	return nil
}

// StopWatcher stops watching a cluster.
func (m *Manager) StopWatcher(clusterName string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if w, exists := m.watchers[clusterName]; exists {
		if w.cancel != nil {
			w.cancel()
		}
		delete(m.watchers, clusterName)
	}
}

// StopAll stops all watchers. Call on shutdown.
func (m *Manager) StopAll() {
	m.mu.Lock()
	defer m.mu.Unlock()

	for name, w := range m.watchers {
		if w.cancel != nil {
			w.cancel()
		}
		delete(m.watchers, name)
	}
}

// GetStats returns the current stats for a cluster.
// Returns an error if the watcher is not running or not yet synced.
func (m *Manager) GetStats(clusterName string) (Stats, error) {
	m.mu.RLock()
	w, exists := m.watchers[clusterName]
	m.mu.RUnlock()

	if !exists {
		return Stats{}, fmt.Errorf("no watcher for cluster %s", clusterName)
	}

	if w.startErr != nil {
		return Stats{}, w.startErr
	}

	w.mu.RLock()
	defer w.mu.RUnlock()

	stats := w.stats
	stats.Synced = w.synced

	return stats, nil
}

// runWatcher starts informers for pods, nodes, and deployments.
func (m *Manager) runWatcher(ctx context.Context, clusterName string, client dynamic.Interface, w *clusterWatcher) {
	logger.Log(logger.LevelInfo, nil, nil, fmt.Sprintf("overviewstats: starting watcher for cluster %s", clusterName))

	factory := dynamicinformer.NewFilteredDynamicSharedInformerFactory(client, 0, metav1.NamespaceAll, nil)

	podGVR := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "pods"}
	nodeGVR := schema.GroupVersionResource{Group: "", Version: "v1", Resource: "nodes"}
	deployGVR := schema.GroupVersionResource{Group: "apps", Version: "v1", Resource: "deployments"}

	podInformer := factory.ForResource(podGVR).Informer()
	nodeInformer := factory.ForResource(nodeGVR).Informer()
	deployInformer := factory.ForResource(deployGVR).Informer()

	// Set transform functions to reduce memory — only keep fields needed for counting.
	if err := podInformer.SetTransform(podTransform); err != nil {
		logger.Log(logger.LevelError, nil, err, "overviewstats: failed to set pod transform")
	}
	if err := nodeInformer.SetTransform(nodeTransform); err != nil {
		logger.Log(logger.LevelError, nil, err, "overviewstats: failed to set node transform")
	}
	if err := deployInformer.SetTransform(deployTransform); err != nil {
		logger.Log(logger.LevelError, nil, err, "overviewstats: failed to set deploy transform")
	}

	// Register event handlers.
	if _, err := podInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { m.recomputePods(w, podInformer) },
		UpdateFunc: func(_, _ interface{}) { m.recomputePods(w, podInformer) },
		DeleteFunc: func(obj interface{}) { m.recomputePods(w, podInformer) },
	}); err != nil {
		w.startErr = fmt.Errorf("adding pod event handler: %w", err)
		return
	}

	if _, err := nodeInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { m.recomputeNodes(w, nodeInformer) },
		UpdateFunc: func(_, _ interface{}) { m.recomputeNodes(w, nodeInformer) },
		DeleteFunc: func(obj interface{}) { m.recomputeNodes(w, nodeInformer) },
	}); err != nil {
		w.startErr = fmt.Errorf("adding node event handler: %w", err)
		return
	}

	if _, err := deployInformer.AddEventHandler(cache.ResourceEventHandlerFuncs{
		AddFunc:    func(obj interface{}) { m.recomputeDeployments(w, deployInformer) },
		UpdateFunc: func(_, _ interface{}) { m.recomputeDeployments(w, deployInformer) },
		DeleteFunc: func(obj interface{}) { m.recomputeDeployments(w, deployInformer) },
	}); err != nil {
		w.startErr = fmt.Errorf("adding deployment event handler: %w", err)
		return
	}

	factory.Start(ctx.Done())

	// Wait for caches to sync.
	synced := factory.WaitForCacheSync(ctx.Done())
	allSynced := true
	for _, s := range synced {
		if !s {
			allSynced = false
			break
		}
	}

	if !allSynced {
		logger.Log(logger.LevelError, nil, nil, fmt.Sprintf("overviewstats: not all informers synced for cluster %s", clusterName))
	}

	// Do initial computation after informers sync but BEFORE marking as
	// synced, so the very first synced response already contains pod/node
	// counts AND CPU/memory data (no N/A flash).
	m.recomputePods(w, podInformer)
	m.recomputeNodes(w, nodeInformer)
	m.recomputeDeployments(w, deployInformer)

	// Run the first metrics poll synchronously. This ensures that when
	// synced is set to true below, the CPU/memory fields are populated.
	// Without this, the first response would have metricsAvailable=false
	// even if metrics-server is present, causing the Home popover to show
	// "N/A" until the next frontend refetch (30 s).
	m.recomputeMetrics(ctx, clusterName, client, nodeInformer, w)

	w.mu.Lock()
	w.synced = allSynced
	w.mu.Unlock()

	// Continue polling metrics in the background (every 15 s).
	go m.pollMetrics(ctx, clusterName, client, nodeInformer, w)

	logger.Log(logger.LevelInfo, nil, nil, fmt.Sprintf("overviewstats: watcher synced for cluster %s", clusterName))

	<-ctx.Done()
	logger.Log(logger.LevelInfo, nil, nil, fmt.Sprintf("overviewstats: watcher stopped for cluster %s", clusterName))
}

// metricsPollInterval controls how often node CPU/memory usage is refreshed.
const metricsPollInterval = 15 * time.Second

// nodeMetricsGVR is the aggregated metrics API for node usage.
var nodeMetricsGVR = schema.GroupVersionResource{
	Group:    "metrics.k8s.io",
	Version:  "v1beta1",
	Resource: "nodes",
}

// pollMetrics periodically aggregates node CPU/memory usage from metrics.k8s.io
// and node capacity from the node informer store, updating w.stats.
func (m *Manager) pollMetrics(
	ctx context.Context,
	clusterName string,
	client dynamic.Interface,
	nodeInformer cache.SharedIndexInformer,
	w *clusterWatcher,
) {
	// A malformed metrics response must never crash the backend.
	defer func() {
		if r := recover(); r != nil {
			logger.Log(logger.LevelError, nil, nil,
				fmt.Sprintf("overviewstats: metrics poll recovered from panic for cluster %s: %v", clusterName, r))
		}
	}()

	// Run once immediately, then on a ticker.
	m.recomputeMetrics(ctx, clusterName, client, nodeInformer, w)

	ticker := time.NewTicker(metricsPollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			m.recomputeMetrics(ctx, clusterName, client, nodeInformer, w)
		}
	}
}

// recomputeMetrics sums node usage (metrics.k8s.io) and capacity (informer store).
func (m *Manager) recomputeMetrics(
	ctx context.Context,
	clusterName string,
	client dynamic.Interface,
	nodeInformer cache.SharedIndexInformer,
	w *clusterWatcher,
) {
	// Sum capacity from the node informer store.
	var cpuCapacity, memCapacity int64

	for _, item := range nodeInformer.GetStore().List() {
		obj, ok := item.(*unstructured.Unstructured)
		if !ok {
			continue
		}

		cpuStr, _, _ := unstructured.NestedString(obj.Object, "status", "capacity", "cpu")
		memStr, _, _ := unstructured.NestedString(obj.Object, "status", "capacity", "memory")

		if q, err := resource.ParseQuantity(cpuStr); err == nil {
			cpuCapacity += q.ScaledValue(resource.Nano)
		}

		if q, err := resource.ParseQuantity(memStr); err == nil {
			memCapacity += q.Value()
		}
	}

	// Sum usage from metrics.k8s.io/v1beta1 nodes.
	list, err := client.Resource(nodeMetricsGVR).List(ctx, metav1.ListOptions{})
	if err != nil {
		// No metrics-server (or transient error): mark unavailable but keep
		// capacity so the UI can still show totals consistently.
		w.mu.Lock()
		w.stats.MetricsAvailable = false
		w.stats.CPU = ResourceUsage{Used: 0, Capacity: cpuCapacity}
		w.stats.Memory = ResourceUsage{Used: 0, Capacity: memCapacity}
		w.stats.LastUpdated = time.Now()
		w.mu.Unlock()

		// Error-level so failures aren't hidden in high-volume Info logs, and
		// include %+v of the error so we can distinguish RBAC / TLS / not-found
		// / timeout without having to attach a debugger.
		logger.Log(logger.LevelError, nil, err,
			fmt.Sprintf("overviewstats: node metrics unavailable for cluster %s: %+v", clusterName, err))

		return
	}

	var cpuUsed, memUsed int64

	for i := range list.Items {
		usage, found, _ := unstructured.NestedStringMap(list.Items[i].Object, "usage")
		if !found {
			continue
		}

		if q, err := resource.ParseQuantity(usage["cpu"]); err == nil {
			cpuUsed += q.ScaledValue(resource.Nano)
		}

		if q, err := resource.ParseQuantity(usage["memory"]); err == nil {
			memUsed += q.Value()
		}
	}

	w.mu.Lock()
	w.stats.MetricsAvailable = true
	w.stats.CPU = ResourceUsage{Used: cpuUsed, Capacity: cpuCapacity}
	w.stats.Memory = ResourceUsage{Used: memUsed, Capacity: memCapacity}
	w.stats.LastUpdated = time.Now()
	w.mu.Unlock()
}

// recomputePods recalculates pod counts from the informer store.
func (m *Manager) recomputePods(w *clusterWatcher, informer cache.SharedIndexInformer) {
	items := informer.GetStore().List()
	ready := 0
	total := len(items)

	for _, item := range items {
		obj, ok := item.(*unstructured.Unstructured)
		if !ok {
			continue
		}
		if isPodReady(obj) {
			ready++
		}
	}

	w.mu.Lock()
	w.stats.Pods = ResourceCount{Ready: ready, Total: total}
	w.stats.LastUpdated = time.Now()
	w.mu.Unlock()
}

// recomputeNodes recalculates node counts from the informer store.
func (m *Manager) recomputeNodes(w *clusterWatcher, informer cache.SharedIndexInformer) {
	items := informer.GetStore().List()
	ready := 0
	total := len(items)

	for _, item := range items {
		obj, ok := item.(*unstructured.Unstructured)
		if !ok {
			continue
		}
		if isNodeReady(obj) {
			ready++
		}
	}

	w.mu.Lock()
	w.stats.Nodes = ResourceCount{Ready: ready, Total: total}
	w.stats.LastUpdated = time.Now()
	w.mu.Unlock()
}

// recomputeDeployments recalculates deployment counts from the informer store.
func (m *Manager) recomputeDeployments(w *clusterWatcher, informer cache.SharedIndexInformer) {
	items := informer.GetStore().List()
	available := 0
	desired := 0

	for _, item := range items {
		obj, ok := item.(*unstructured.Unstructured)
		if !ok {
			continue
		}
		a, d := getDeploymentCounts(obj)
		available += a
		desired += d
	}

	w.mu.Lock()
	w.stats.Deployments = DeploymentCount{Available: available, Desired: desired}
	w.stats.LastUpdated = time.Now()
	w.mu.Unlock()
}

// --- Transform functions (strip objects to minimal fields) ---

// podTransform keeps only status.phase and status.conditions for counting.
func podTransform(obj interface{}) (interface{}, error) {
	u, ok := obj.(*unstructured.Unstructured)
	if !ok {
		return obj, nil
	}

	phase, _, _ := unstructured.NestedString(u.Object, "status", "phase")
	conditions, _, _ := unstructured.NestedSlice(u.Object, "status", "conditions")

	stripped := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": u.GetAPIVersion(),
			"kind":       u.GetKind(),
			"metadata": map[string]interface{}{
				"name":      u.GetName(),
				"namespace": u.GetNamespace(),
				"uid":       string(u.GetUID()),
			},
			"status": map[string]interface{}{
				"phase":      phase,
				"conditions": conditions,
			},
		},
	}
	return stripped, nil
}

// nodeTransform keeps status.conditions (for readiness) and status.capacity
// (for CPU/memory totals) for counting.
func nodeTransform(obj interface{}) (interface{}, error) {
	u, ok := obj.(*unstructured.Unstructured)
	if !ok {
		return obj, nil
	}

	conditions, _, _ := unstructured.NestedSlice(u.Object, "status", "conditions")
	capacity, _, _ := unstructured.NestedMap(u.Object, "status", "capacity")

	stripped := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": u.GetAPIVersion(),
			"kind":       u.GetKind(),
			"metadata": map[string]interface{}{
				"name": u.GetName(),
				"uid":  string(u.GetUID()),
			},
			"status": map[string]interface{}{
				"conditions": conditions,
				"capacity":   capacity,
			},
		},
	}
	return stripped, nil
}

// deployTransform keeps only spec.replicas and status.availableReplicas.
func deployTransform(obj interface{}) (interface{}, error) {
	u, ok := obj.(*unstructured.Unstructured)
	if !ok {
		return obj, nil
	}

	replicas, _, _ := unstructured.NestedInt64(u.Object, "spec", "replicas")
	available, _, _ := unstructured.NestedInt64(u.Object, "status", "availableReplicas")

	stripped := &unstructured.Unstructured{
		Object: map[string]interface{}{
			"apiVersion": u.GetAPIVersion(),
			"kind":       u.GetKind(),
			"metadata": map[string]interface{}{
				"name":      u.GetName(),
				"namespace": u.GetNamespace(),
				"uid":       string(u.GetUID()),
			},
			"spec": map[string]interface{}{
				"replicas": replicas,
			},
			"status": map[string]interface{}{
				"availableReplicas": available,
			},
		},
	}
	return stripped, nil
}

// --- Status checking helpers ---

// isPodReady returns true if pod is Succeeded or has Ready condition True.
func isPodReady(obj *unstructured.Unstructured) bool {
	phase, _, _ := unstructured.NestedString(obj.Object, "status", "phase")
	if phase == "Succeeded" {
		return true
	}

	conditions, _, _ := unstructured.NestedSlice(obj.Object, "status", "conditions")
	for _, c := range conditions {
		cond, ok := c.(map[string]interface{})
		if !ok {
			continue
		}
		condType, _ := cond["type"].(string)
		condStatus, _ := cond["status"].(string)
		if condType == "Ready" && condStatus == "True" {
			return true
		}
	}

	return false
}

// isNodeReady returns true if node has Ready condition True.
func isNodeReady(obj *unstructured.Unstructured) bool {
	conditions, _, _ := unstructured.NestedSlice(obj.Object, "status", "conditions")
	for _, c := range conditions {
		cond, ok := c.(map[string]interface{})
		if !ok {
			continue
		}
		condType, _ := cond["type"].(string)
		condStatus, _ := cond["status"].(string)
		if condType == "Ready" && condStatus == "True" {
			return true
		}
	}

	return false
}

// getDeploymentCounts returns (available, desired) for a deployment.
func getDeploymentCounts(obj *unstructured.Unstructured) (int, int) {
	replicas, _, _ := unstructured.NestedInt64(obj.Object, "spec", "replicas")
	available, _, _ := unstructured.NestedInt64(obj.Object, "status", "availableReplicas")

	return int(available), int(replicas)
}

// --- HTTP Handler ---

// HandleOverviewStats returns an HTTP handler for the overview stats endpoint.
func HandleOverviewStats(mgr *Manager, kubeConfigStore kubeconfig.ContextStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		// Extract cluster name from URL path variables (gorilla/mux).
		vars := muxVars(r)
		clusterName := vars["clusterName"]

		if clusterName == "" {
			writeJSONError(w, "missing cluster name", http.StatusBadRequest)
			return
		}

		// Ensure watcher is running (lazy start).
		kContext, err := kubeConfigStore.GetContext(clusterName)
		if err != nil {
			writeJSONError(w, "cluster not found", http.StatusNotFound)
			return
		}

		if err := mgr.StartWatcher(clusterName, kContext); err != nil {
			logger.Log(logger.LevelError, nil, err, "overviewstats: failed to start watcher")
			writeJSONError(w, "failed to start watcher", http.StatusInternalServerError)
			return
		}

		stats, err := mgr.GetStats(clusterName)
		if err != nil {
			writeJSONError(w, "stats not available", http.StatusServiceUnavailable)
			return
		}

		w.Header().Set("Content-Type", "application/json")

		if !stats.Synced {
			w.Header().Set("X-Data-Status", "syncing")
			w.WriteHeader(http.StatusAccepted)
		} else {
			w.Header().Set("X-Data-Status", "synced")
			w.Header().Set("X-Data-Age", fmt.Sprintf("%d", time.Since(stats.LastUpdated).Milliseconds()))
		}

		if err := json.NewEncoder(w).Encode(stats); err != nil {
			logger.Log(logger.LevelError, nil, err, "overviewstats: failed to encode response")
		}
	}
}

// writeJSONError writes a safe JSON error response without interpolating user input.
func writeJSONError(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(map[string]string{"error": msg})
}

// muxVars extracts gorilla/mux path variables. Defined as a var for testing.
var muxVars = func(r *http.Request) map[string]string {
	return mux.Vars(r)
}
