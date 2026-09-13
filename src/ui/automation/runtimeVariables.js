function normalizeRuntimeValue(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') {
        return String(value);
    }
    try {
        return JSON.stringify(value);
    } catch (_) {
        return String(value);
    }
}

function setRuntimeVariable(context, name, value) {
    const key = String(name || '').trim();
    if (!key) return;
    context.runtimeVariables[key] = normalizeRuntimeValue(value);
}

function setFlattenedRuntimeVariables(context, prefix, value) {
    if (!prefix) return;
    if (value == null) {
        setRuntimeVariable(context, prefix, '');
        return;
    }
    if (Array.isArray(value)) {
        setRuntimeVariable(context, prefix, value);
        value.forEach((item, index) => {
            setFlattenedRuntimeVariables(context, `${prefix}.${index}`, item);
        });
        return;
    }
    if (typeof value === 'object') {
        setRuntimeVariable(context, prefix, value);
        Object.entries(value).forEach(([key, nestedValue]) => {
            setFlattenedRuntimeVariables(context, `${prefix}.${key}`, nestedValue);
        });
        return;
    }
    setRuntimeVariable(context, prefix, value);
}

function resolveRuntimeToken(context, token) {
    const key = String(token || '').trim();
    if (!key) return null;
    if (key === 'u_capture' && context.capturedData != null) {
        return normalizeRuntimeValue(context.capturedData);
    }
    if (Object.prototype.hasOwnProperty.call(context.runtimeVariables, key)) {
        return context.runtimeVariables[key];
    }
    return null;
}

function resolveRuntimeValue(context, value) {
    if (typeof value === 'string') {
        return value.replace(/{{\s*([^}]+)\s*}}/g, (match, token) => {
            const resolved = resolveRuntimeToken(context, token);
            return resolved == null ? match : resolved;
        });
    }
    if (Array.isArray(value)) {
        return value.map(item => resolveRuntimeValue(context, item));
    }
    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, nestedValue]) => [key, resolveRuntimeValue(context, nestedValue)]),
        );
    }
    return value;
}

module.exports = {
    normalizeRuntimeValue,
    setRuntimeVariable,
    setFlattenedRuntimeVariables,
    resolveRuntimeToken,
    resolveRuntimeValue,
};
