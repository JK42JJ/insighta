{{- define "insighta.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "insighta.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := include "insighta.name" . }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "insighta.labels" -}}
app.kubernetes.io/name: {{ include "insighta.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
{{- end }}

{{- define "insighta.selectorLabels" -}}
app.kubernetes.io/name: {{ include "insighta.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Pull secrets, rendered only when some are configured. Emitting an empty
`imagePullSecrets:` key is legal but noisy in diffs, so the whole block
disappears when the list is empty.
*/}}
{{- define "insighta.imagePullSecrets" -}}
{{- with .Values.imagePullSecrets }}
imagePullSecrets:
{{- range . }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Full image reference. Prefixes .Values.imageRegistry when set, so the same
chart serves a cluster pulling from a private registry whose host cannot be
committed and one pulling from the repository as written.
*/}}
{{- define "insighta.image" -}}
{{- $reg := .root.Values.imageRegistry | default "" -}}
{{- if $reg -}}
{{ $reg }}/{{ base .img.repository }}:{{ .img.tag }}
{{- else -}}
{{ .img.repository }}:{{ .img.tag }}
{{- end -}}
{{- end }}

{{/*
Fails the render when an environment declares it needs a registry and none was
supplied. A missing registry otherwise surfaces as ImagePullBackOff with no
indication that a parameter was forgotten.
*/}}
{{- define "insighta.checkRegistry" -}}
{{- if and .Values.requireImageRegistry (not .Values.imageRegistry) }}
{{- fail "this environment sets requireImageRegistry=true but imageRegistry is empty: pass --set imageRegistry=<host>, or set it in the Argo Application's helm.parameters. It is not committed because it contains the AWS account id and this repository is public." }}
{{- end }}
{{- end }}

{{- define "insighta.spread" -}}
{{- if .root.Values.spreadAcrossNodes }}
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        {{- include "insighta.selectorLabels" .root | nindent 8 }}
        app.kubernetes.io/component: {{ .component }}
{{- end }}
{{- end }}
