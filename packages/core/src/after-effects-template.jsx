// xsheet-remap After Effects remap JSX v1
(function () {
  var ADBE_TIME_REMAPPING = "ADBE Time Remapping";
  var ADBE_EFFECT_PARADE = "ADBE Effect Parade";
  var ADBE_VENETIAN_BLINDS = "ADBE Venetian Blinds";
  var ADBE_VENETIAN_BLINDS_COMPLETION = "ADBE Venetian Blinds-0001";
  var XSHEET_AE_CONFIG = __XSHEET_AE_CONFIG__;
  var XSHEET_AE_PLAN = XSHEET_AE_CONFIG.plan;
  var DIALOG_TITLE = XSHEET_AE_CONFIG.options.dialogTitle;
  var UNDO_GROUP_NAME = XSHEET_AE_CONFIG.options.undoGroupName;
  var MANAGED_BLANK_EFFECT_NAME = XSHEET_AE_CONFIG.options.managedBlankEffectName;
  var VALIDATION_EPSILON_SECONDS = 0.000001;
  // durationFrames is the sheet-covered interval. Mapped footage layers are
  // extended only when needed; no terminal key shortens a longer existing range.
  var SHEET_DURATION_SECONDS = XSHEET_AE_PLAN.durationFrames / XSHEET_AE_PLAN.compFps;

  function normalizeName(value) {
    return String(value || "")
      .replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (character) {
        return String.fromCharCode(character.charCodeAt(0) - 0xFEE0);
      })
      .replace(/^\s+|\s+$/g, "")
      .toLowerCase();
  }

  function automaticColumnIndex(layerName) {
    var normalizedLayerName = normalizeName(layerName);
    var prefix = normalizedLayerName.split("_")[0];
    for (var i = 0; i < XSHEET_AE_PLAN.columns.length; i += 1) {
      var columnName = normalizeName(XSHEET_AE_PLAN.columns[i].name);
      var columnId = normalizeName(XSHEET_AE_PLAN.columns[i].id);
      if (columnName === normalizedLayerName || columnId === normalizedLayerName) return i + 1;
    }
    for (var j = 0; j < XSHEET_AE_PLAN.columns.length; j += 1) {
      var prefixName = normalizeName(XSHEET_AE_PLAN.columns[j].name);
      var prefixId = normalizeName(XSHEET_AE_PLAN.columns[j].id);
      if (prefixName === prefix || prefixId === prefix) return j + 1;
    }
    return 0;
  }

  function candidateLayers(comp) {
    var sourceLayers = comp.selectedLayers.length > 0 ? comp.selectedLayers : null;
    var result = [];
    var i;
    if (sourceLayers) {
      for (i = 0; i < sourceLayers.length; i += 1) {
        if (sourceLayers[i] instanceof AVLayer) result.push(sourceLayers[i]);
      }
      return result;
    }
    for (i = 1; i <= comp.numLayers; i += 1) {
      if (comp.layer(i) instanceof AVLayer) result.push(comp.layer(i));
    }
    return result;
  }

  function managedBlankEffect(layer) {
    var effects = layer.property(ADBE_EFFECT_PARADE);
    if (!effects) return null;
    return effects.property(MANAGED_BLANK_EFFECT_NAME);
  }

  function columnHasCells(column) {
    for (var i = 0; i < column.keys.length; i += 1) {
      if (!column.keys[i].empty) return true;
    }
    return false;
  }

  function columnHasEmptyCells(column) {
    for (var i = 0; i < column.keys.length; i += 1) {
      if (column.keys[i].empty) return true;
    }
    return false;
  }

  function sourceFrameRateForLayer(layer) {
    var sourceFrameRate = layer.source ? Number(layer.source.frameRate) : NaN;
    if (isFinite(sourceFrameRate) && sourceFrameRate > 0) return sourceFrameRate;
    return XSHEET_AE_PLAN.sourceFps;
  }

  function sourceSecondsForCellNumber(cellNumber, sourceFrameRate) {
    return (cellNumber - 1) / sourceFrameRate;
  }

  function maximumSourceSeconds(column, sourceFrameRate) {
    var maximum = null;
    for (var i = 0; i < column.keys.length; i += 1) {
      var key = column.keys[i];
      if (!key.empty) {
        var seconds = sourceSecondsForCellNumber(key.cellNumber, sourceFrameRate);
        if (maximum === null || seconds > maximum) maximum = seconds;
      }
    }
    return maximum;
  }

  function removeKeysOutside(property, times) {
    for (var keyIndex = property.numKeys; keyIndex >= 1; keyIndex -= 1) {
      var keyTime = property.keyTime(keyIndex);
      var keep = false;
      for (var timeIndex = 0; timeIndex < times.length; timeIndex += 1) {
        if (Math.abs(keyTime - times[timeIndex]) <= VALIDATION_EPSILON_SECONDS) {
          keep = true;
          break;
        }
      }
      if (!keep) property.removeKey(keyIndex);
    }
  }

  function setHoldInterpolation(property) {
    for (var i = 1; i <= property.numKeys; i += 1) {
      property.setInterpolationTypeAtKey(i, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
    }
  }

  function setKeyValues(property, times, values, context) {
    // AE 2026 can reject the bulk setValuesAtTimes API for an otherwise
    // writable effect property as "hidden". Sparse sheet keys are small
    // enough to set individually, which also works in older AE versions.
    for (var i = 0; i < times.length; i += 1) {
      try {
        property.setValueAtTime(times[i], values[i]);
      } catch (error) {
        throw new Error(context + " at sheet time " + times[i] + " seconds: " + error.toString());
      }
    }
    // Time Remap becomes a hidden property in AE 2026 if its final default key
    // is removed before replacement keys are added. Add/replace the desired
    // keys first, then prune the old defaults and other managed keys.
    removeKeysOutside(property, times);
  }

  function extendLayerToSheet(layer) {
    var layerInPoint = Number(layer.inPoint);
    var layerOutPoint = Number(layer.outPoint);
    if (!isFinite(layerInPoint) || !isFinite(layerOutPoint)) {
      throw new Error("Layer range is not finite on " + layer.name + ".");
    }
    if (layerInPoint > VALIDATION_EPSILON_SECONDS) layer.inPoint = 0;
    if (layerOutPoint + VALIDATION_EPSILON_SECONDS < SHEET_DURATION_SECONDS) {
      layer.outPoint = SHEET_DURATION_SECONDS;
    }
  }

  function applyTimeRemap(layer, column) {
    if (!columnHasCells(column)) return;
    if (!layer.timeRemapEnabled) layer.timeRemapEnabled = true;
    extendLayerToSheet(layer);
    var property = layer.property(ADBE_TIME_REMAPPING);
    if (!property) throw new Error("Time Remap could not be enabled on " + layer.name + ".");
    var times = [];
    var values = [];
    var sourceFrameRate = sourceFrameRateForLayer(layer);
    for (var i = 0; i < column.keys.length; i += 1) {
      var key = column.keys[i];
      if (key.empty) continue;
      times.push(key.frame / XSHEET_AE_PLAN.compFps);
      values.push(sourceSecondsForCellNumber(key.cellNumber, sourceFrameRate));
    }
    setKeyValues(property, times, values, "Time Remap on " + layer.name);
    setHoldInterpolation(property);
  }

  function applyBlankEffect(layer, column) {
    var effect = managedBlankEffect(layer);
    var hasEmptyCells = columnHasEmptyCells(column);
    if (!effect && !hasEmptyCells) return;
    if (!effect) {
      effect = layer.property(ADBE_EFFECT_PARADE).addProperty(ADBE_VENETIAN_BLINDS);
      effect.name = MANAGED_BLANK_EFFECT_NAME;
    }
    if (effect.matchName !== ADBE_VENETIAN_BLINDS) {
      throw new Error("The managed blank effect name is already used by another effect on " + layer.name + ".");
    }
    var property = effect.property(ADBE_VENETIAN_BLINDS_COMPLETION);
    var times = [];
    var values = [];
    if (hasEmptyCells) {
      for (var i = 0; i < column.keys.length; i += 1) {
        times.push(column.keys[i].frame / XSHEET_AE_PLAN.compFps);
        values.push(column.keys[i].empty ? 100 : 0);
      }
    } else {
      times.push(0);
      values.push(0);
    }
    setKeyValues(property, times, values, MANAGED_BLANK_EFFECT_NAME + " on " + layer.name);
    setHoldInterpolation(property);
  }

  var comp = app.project.activeItem;
  if (!comp || !(comp instanceof CompItem)) {
    alert("Select an active composition before running XSHEET Remap.");
    return;
  }
  var compDuration = Number(comp.duration);
  if (!isFinite(compDuration) || compDuration + VALIDATION_EPSILON_SECONDS < SHEET_DURATION_SECONDS) {
    alert(
      "The active composition is shorter than the sheet duration ("
        + XSHEET_AE_PLAN.durationFrames + " frames / " + SHEET_DURATION_SECONDS + " seconds)."
    );
    return;
  }
  if (Math.abs(comp.frameRate - XSHEET_AE_PLAN.compFps) > 0.01) {
    if (!confirm("The composition FPS (" + comp.frameRate + ") differs from the sheet FPS (" + XSHEET_AE_PLAN.compFps + "). Continue?")) return;
  }

  var layers = candidateLayers(comp);
  if (layers.length === 0) {
    alert(comp.selectedLayers.length > 0
      ? "The selected layers do not contain an AV layer."
      : "The active composition does not contain an AV layer.");
    return;
  }

  var labels = ["Do not apply"];
  var i;
  for (i = 0; i < XSHEET_AE_PLAN.columns.length; i += 1) {
    labels.push(XSHEET_AE_PLAN.columns[i].name);
  }
  var dialog = new Window("dialog", DIALOG_TITLE);
  dialog.orientation = "column";
  dialog.alignChildren = ["fill", "top"];
  dialog.add("statictext", undefined, "Choose the logical sheet column for each After Effects layer.");
  dialog.add("statictext", undefined,
    "Sheet duration: " + XSHEET_AE_PLAN.durationFrames + " frames (0 to " + SHEET_DURATION_SECONDS + " seconds)."
  );
  dialog.add("statictext", undefined,
    "Mapped footage layers are enabled for Time Remap and extended to cover the sheet when needed; existing longer ranges are kept."
  );
  var dropdowns = [];
  for (i = 0; i < layers.length; i += 1) {
    var row = dialog.add("group");
    row.add("statictext", undefined, layers[i].name);
    var dropdown = row.add("dropdownlist", undefined, labels);
    dropdown.selection = automaticColumnIndex(layers[i].name);
    dropdowns.push(dropdown);
  }
  var buttons = dialog.add("group");
  buttons.alignment = "right";
  buttons.add("button", undefined, "Cancel", { name: "cancel" });
  buttons.add("button", undefined, "Apply", { name: "ok" });
  if (dialog.show() !== 1) return;

  var assignments = [];
  for (i = 0; i < layers.length; i += 1) {
    var selectedIndex = dropdowns[i].selection ? dropdowns[i].selection.index : 0;
    if (selectedIndex > 0) assignments.push({ layer: layers[i], column: XSHEET_AE_PLAN.columns[selectedIndex - 1] });
  }
  if (assignments.length === 0) {
    alert("No layer was mapped. Nothing was changed.");
    return;
  }

  var blocking = [];
  var conflicts = [];
  for (i = 0; i < assignments.length; i += 1) {
    var assignment = assignments[i];
    var layer = assignment.layer;
    if (layer.locked) blocking.push(layer.name + ": layer is locked");
    var layerInPoint = Number(layer.inPoint);
    var layerOutPoint = Number(layer.outPoint);
    if (!isFinite(layerInPoint) || !isFinite(layerOutPoint)) {
      blocking.push(
        layer.name + ": layer range is not finite (inPoint "
          + layerInPoint + ", outPoint " + layerOutPoint + ")"
      );
    }
    if (columnHasCells(assignment.column) && !layer.canSetTimeRemapEnabled) {
      blocking.push(layer.name + ": Time Remap is not supported");
    }
    var sourceFrameRate = sourceFrameRateForLayer(layer);
    var maximumSeconds = maximumSourceSeconds(assignment.column, sourceFrameRate);
    if (maximumSeconds !== null) {
      var sourceDuration = layer.source ? Number(layer.source.duration) : NaN;
      if (!isFinite(sourceDuration) || sourceDuration <= maximumSeconds) {
        blocking.push(
          layer.name + ": source duration (" + sourceDuration
            + " seconds) does not contain the required source time (" + maximumSeconds + " seconds)"
        );
      }
    }
    if (columnHasCells(assignment.column) && layer.timeRemapEnabled) {
      var existingTimeRemap = layer.property(ADBE_TIME_REMAPPING);
      if (!existingTimeRemap) {
        blocking.push(layer.name + ": the existing Time Remap property cannot be inspected");
      } else if (existingTimeRemap.expressionEnabled
        || String(existingTimeRemap.expression || "").length > 0) {
        blocking.push(layer.name + ": the existing Time Remap has an expression; remove it before retrying");
      } else {
        conflicts.push(layer.name + ": existing Time Remap keys will be replaced");
      }
    }
    var existingEffect = managedBlankEffect(layer);
    if (existingEffect) {
      if (existingEffect.matchName !== ADBE_VENETIAN_BLINDS) {
        blocking.push(layer.name + ": the managed blank-effect name belongs to another effect");
      } else {
        var existingBlankProperty = existingEffect.property(ADBE_VENETIAN_BLINDS_COMPLETION);
        if (!existingBlankProperty) {
          blocking.push(layer.name + ": the managed blank effect has no writable completion property");
        } else if (existingEffect.enabled === false) {
          blocking.push(layer.name + ": the managed blank effect is disabled; enable or remove it before retrying");
        } else if (existingBlankProperty.expressionEnabled
          || String(existingBlankProperty.expression || "").length > 0) {
          blocking.push(layer.name + ": the managed blank-effect completion has an expression; remove it before retrying");
        } else {
          conflicts.push(layer.name + ": existing " + MANAGED_BLANK_EFFECT_NAME + " keys will be replaced");
        }
      }
    }
  }
  if (blocking.length > 0) {
    alert("XSHEET Remap cannot continue:\n\n" + blocking.join("\n"));
    return;
  }
  if (conflicts.length > 0 && !confirm(
    "Existing Time Remap or managed blank-effect data was found:\n\n"
      + conflicts.join("\n")
      + "\n\nReplace that data for the mapped layers?"
  )) return;

  var originalSelection = [];
  for (i = 1; i <= comp.numLayers; i += 1) originalSelection.push(comp.layer(i).selected);
  app.beginUndoGroup(UNDO_GROUP_NAME);
  try {
    // Sparse HOLD keys intentionally have no durationFrames terminal key. Short
    // mapped footage layers are extended, while longer ranges keep holding.
    for (i = 0; i < assignments.length; i += 1) {
      applyTimeRemap(assignments[i].layer, assignments[i].column);
      applyBlankEffect(assignments[i].layer, assignments[i].column);
    }
  } catch (error) {
    alert("XSHEET Remap stopped: " + error.toString());
  } finally {
    try {
      for (i = 1; i <= comp.numLayers; i += 1) comp.layer(i).selected = originalSelection[i - 1];
    } finally {
      app.endUndoGroup();
    }
  }
}());
