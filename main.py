from fastapi import FastAPI
from api import app as inner

app = FastAPI()
app.mount("/api", inner)
app.mount("/", inner)