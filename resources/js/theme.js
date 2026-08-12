export function cssColor(variableName) {
    const value = window.getComputedStyle(document.documentElement)
        .getPropertyValue(variableName)
        .trim();

    if (!value) {
        throw new Error(`CSS variable ${variableName} belum didefinisikan.`);
    }

    return value;
}
