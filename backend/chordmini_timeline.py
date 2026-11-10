# Adapted from ChordMiniApp (MIT); source revision in source-pins.json.
from typing import List, Dict, Any, Tuple

def merge_consecutive_chords(chord_data: List[Dict[str, Any]], tolerance: float = 0.01) -> List[Dict[str, Any]]:
    """
    Merge consecutive chord annotations with the same chord label.
    
    Args:
        chord_data: List of chord annotations
        tolerance: Time tolerance for merging (seconds)
        
    Returns:
        List of merged chord annotations
    """
    if not chord_data:
        return []
    
    merged = []
    current = chord_data[0].copy()
    
    for next_chord in chord_data[1:]:
        # Check if chords are the same and consecutive
        if (current["chord"] == next_chord["chord"] and 
            abs(current["end_time"] - next_chord["start_time"]) <= tolerance):
            # Merge by extending the end time
            current["end_time"] = next_chord["end_time"]
        else:
            # Add current chord and start a new one
            merged.append(current)
            current = next_chord.copy()
    
    # Add the last chord
    merged.append(current)
    
    return merged

def calculate_chord_statistics(chord_data: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Calculate statistics about chord annotations.
    
    Args:
        chord_data: List of chord annotations
        
    Returns:
        Dict containing chord statistics
    """
    if not chord_data:
        return {
            "total_chords": 0,
            "unique_chords": 0,
            "average_duration": 0.0,
            "total_duration": 0.0,
            "chord_counts": {}
        }
    
    # Count chord occurrences
    chord_counts = {}
    total_duration = 0.0
    durations = []
    
    for chord in chord_data:
        chord_label = chord["chord"]
        duration = chord["end_time"] - chord["start_time"]
        
        chord_counts[chord_label] = chord_counts.get(chord_label, 0) + 1
        total_duration += duration
        durations.append(duration)
    
    return {
        "total_chords": len(chord_data),
        "unique_chords": len(chord_counts),
        "average_duration": sum(durations) / len(durations) if durations else 0.0,
        "total_duration": total_duration,
        "chord_counts": chord_counts,
        "min_duration": min(durations) if durations else 0.0,
        "max_duration": max(durations) if durations else 0.0
    }

def validate_chord_data(chord_data: List[Dict[str, Any]]) -> Tuple[bool, List[str]]:
    """
    Validate chord data for consistency and correctness.
    
    Args:
        chord_data: List of chord annotations
        
    Returns:
        Tuple of (is_valid, list_of_errors)
    """
    errors = []
    
    if not chord_data:
        errors.append("No chord data provided")
        return False, errors
    
    # Check required fields
    required_fields = ["start_time", "end_time", "chord"]
    for i, chord in enumerate(chord_data):
        for field in required_fields:
            if field not in chord:
                errors.append(f"Chord {i}: Missing required field '{field}'")
        
        # Check time validity
        if "start_time" in chord and "end_time" in chord:
            if chord["start_time"] >= chord["end_time"]:
                errors.append(f"Chord {i}: Invalid time range ({chord['start_time']} >= {chord['end_time']})")
    
    # Check temporal consistency
    for i in range(len(chord_data) - 1):
        current = chord_data[i]
        next_chord = chord_data[i + 1]
        
        if "end_time" in current and "start_time" in next_chord:
            if current["end_time"] > next_chord["start_time"]:
                errors.append(f"Chord {i}-{i+1}: Overlapping time ranges")
    
    return len(errors) == 0, errors
