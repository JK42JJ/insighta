{{- define "insighta.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "insighta.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name (include "insighta.name" .) | trunc 63 | trimSuffix "-" }}
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
