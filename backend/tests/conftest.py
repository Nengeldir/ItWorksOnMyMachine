import os
import tempfile

# The app opens its SQLite file on import: point it at a throwaway directory
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="game-test-")
