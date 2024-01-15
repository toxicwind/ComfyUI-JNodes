import os

import re

import folder_paths
from .logger import logger

import torch
import random

import numpy as np

from PIL import Image
from typing import Dict, List, Optional, Union

class AnyType(str):
  """A special class that is always equal in not equal comparisons. Credit to pythongosssss and rgthree"""

  def __ne__(self, __value: object) -> bool:
    return False

any = AnyType("*")

    
VIDEO_FORMATS_DIRECTORY = os.path.join(os.path.dirname(os.path.abspath(__file__)), "video_formats")
VIDEO_FORMATS = [x[:-5] for x in os.listdir(VIDEO_FORMATS_DIRECTORY)]

JNODES_IMAGE_FORMAT_TYPES = ["jpg", "png", "gif", "webp", "apng", "mjpeg"] + VIDEO_FORMATS
JNODES_VAE_LIST = ["Baked VAE"] + folder_paths.get_filename_list("vae")


ACCEPTED_VIDEO_EXTENSIONS = ['webm', 'mp4', 'mkv']
ACCEPTED_IMAGE_EXTENSIONS = ['gif', 'webp', 'apng', 'mjpeg']


@staticmethod
def return_random_int(min = 1, max = 100000):
    return random.randint(min, max)

def make_exclusive_list(original_list, items_to_remove):
    return [item for item in original_list if item not in items_to_remove]
    
def get_extension(filename):
    file_parts = filename.split('.')
    return len(file_parts) > 1 and file_parts[-1]

def is_webp(filename):
     return get_extension(filename) == "webp"

def is_gif(filename):
    return get_extension(filename) == "gif"

def is_video(filename):
    return get_extension(filename) in ACCEPTED_VIDEO_EXTENSIONS


def pil2tensor(image: Union[Image.Image, List[Image.Image]]) -> torch.Tensor:
    if isinstance(image, list):
        return torch.cat([pil2tensor(img) for img in image], dim=0)

    return torch.from_numpy(np.array(image).astype(np.float32) / 255.0).unsqueeze(0)