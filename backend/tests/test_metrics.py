"""进程指标测试：计数器/直方图语义与 Prometheus 文本格式。"""
from app.metrics import Metrics


def test_counter_accumulates_with_labels():
    m = Metrics()
    m.inc_counter("chat", agent="insurance", status="ok")
    m.inc_counter("chat", agent="insurance", status="ok")
    m.inc_counter("chat", agent="insurance", status="error")
    text = m.render()
    assert 'piwren_chat_total{agent="insurance",status="error"} 1' in text
    assert 'piwren_chat_total{agent="insurance",status="ok"} 2' in text


def test_histogram_buckets_and_sum():
    m = Metrics(buckets_ms=(100, 1000))
    m.observe("chat_duration", 50)
    m.observe("chat_duration", 500)
    m.observe("chat_duration", 5000)
    text = m.render()
    assert 'piwren_chat_duration_milliseconds_bucket{le="100"} 1' in text
    assert 'piwren_chat_duration_milliseconds_bucket{le="1000"} 2' in text
    assert 'piwren_chat_duration_milliseconds_bucket{le="+Inf"} 3' in text
    assert "piwren_chat_duration_milliseconds_sum 5550.0" in text
    assert "piwren_chat_duration_milliseconds_count 3" in text


def test_render_is_valid_prometheus_text():
    m = Metrics()
    m.inc_counter("chat", status="ok")
    m.observe("chat_duration", 10)
    for line in m.render().strip().splitlines():
        assert not line.startswith("# ") or "HELP" in line or "TYPE" in line
        if line and not line.startswith("#"):
            name, _, value = line.rpartition(" ")
            assert name and float(value) >= 0


def test_uptime_gauge_present():
    m = Metrics()
    assert "piwren_process_uptime_seconds" in m.render()
