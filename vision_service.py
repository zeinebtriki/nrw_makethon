import cv2
import json
import os
import numpy as np

import segmentation as S
from part_classifier import PartClassifier

class IntakeVisionScanner:
    def __init__(self, model_path="model.npz", zone_path="zone.json", camera_index=1):
        self.model_path = model_path
        self.zone_path = zone_path
        self.camera_index = camera_index
        
        # Load the trained machine learning model
        if not os.path.exists(self.model_path):
            raise FileNotFoundError(f"Model file '{self.model_path}' not found!")
        self.clf = PartClassifier.load(self.model_path)
        self.area_range = self.clf.area_frac_range()

        # Load optional ROI zone if defined
        self.zone = None
        if os.path.exists(self.zone_path):
            try:
                with open(self.zone_path, "r") as f:
                    self.zone = tuple(json.load(f))
            except Exception:
                self.zone = None

    def capture_part_type(self) -> str:
        """
        Opens camera, captures a frame, runs teammate's candidate 
        segmentation and part classifier, then closes camera.
        """
        cap = cv2.VideoCapture(self.camera_index)
        if not cap.isOpened():
            return "UNKNOWN"

        ret, frame = cap.read()
        cap.release()

        if not ret or frame is None:
            return "UNKNOWN"

        # Frame analysis using teammate's segmentation setup
        frame_area = (self.zone[2] * self.zone[3]) if self.zone is not None else (frame.shape[0] * frame.shape[1])
        candidates = S.segment_candidates(frame, background=None, roi=self.zone, area_range=self.area_range)

        if not candidates:
            return "UNKNOWN"

        # Classify segment candidates
        res, mask, cnt = self.clf.classify_candidates(candidates, frame_area)
        
        if res and res.get("accepted", False):
            # Returns exact type string (e.g. 'Type A - Small Core')
            return res.get("raw_label", "UNKNOWN")
            
        return "UNKNOWN"