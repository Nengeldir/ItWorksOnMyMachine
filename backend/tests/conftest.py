import os
import tempfile

# The app opens its SQLite file on import: point it at a throwaway directory
os.environ["DATA_DIR"] = tempfile.mkdtemp(prefix="game-test-")
# As deployed behind the portal (docker-compose.yml); tests that need it off unset it
os.environ["TRUST_USER_HEADERS"] = "1"
# Inventory grants (the dev tool) for the tests; production never sets it
os.environ["DEV_TOOLS"] = "1"
