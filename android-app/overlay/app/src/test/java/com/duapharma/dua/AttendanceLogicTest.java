package com.duapharma.dua;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;

import org.junit.Test;

public class AttendanceLogicTest {

    private static final String ID = "3f2c1a9e-1111-4222-8333-444455556666";

    @Test
    public void aGoodPlaceIsAccepted() {
        assertNull(AttendanceLogic.validateSite(ID, 31.5204, 74.3587, 100));
        assertNull(AttendanceLogic.validateSite(ID, -90, 180, 20));
        assertNull(AttendanceLogic.validateSite(ID, 90, -180, 2000));
    }

    @Test
    public void aBadPlaceIsRefused() {
        assertNotNull(AttendanceLogic.validateSite(null, 10, 20, 100));
        assertNotNull(AttendanceLogic.validateSite("x", 10, 20, 100));
        assertNotNull(AttendanceLogic.validateSite("not a uuid!!", 10, 20, 100));
        assertNotNull(AttendanceLogic.validateSite(ID, 91, 20, 100));
        assertNotNull(AttendanceLogic.validateSite(ID, 10, -181, 100));
        assertNotNull(AttendanceLogic.validateSite(ID, Double.NaN, 20, 100));
        assertNotNull(AttendanceLogic.validateSite(ID, 10, 20, 19));
        assertNotNull(AttendanceLogic.validateSite(ID, 10, 20, 2001));
    }

    @Test
    public void theStabilityPeriodHasTheDatabasesRange() {
        assertNull(AttendanceLogic.validateStable(30));
        assertNull(AttendanceLogic.validateStable(120));
        assertNull(AttendanceLogic.validateStable(600));
        assertNotNull(AttendanceLogic.validateStable(29));
        assertNotNull(AttendanceLogic.validateStable(601));
    }

    @Test
    public void transitionsHaveNames() {
        assertEquals("enter", AttendanceLogic.transitionName(1));
        assertEquals("exit", AttendanceLogic.transitionName(2));
        assertEquals("dwell", AttendanceLogic.transitionName(4));
        assertNull(AttendanceLogic.transitionName(0));
        assertNull(AttendanceLogic.transitionName(3));
        assertNull(AttendanceLogic.transitionName(8));
    }

    @Test
    public void requestIdsRoundTripAndForeignOnesAreIgnored() {
        assertEquals(ID, AttendanceLogic.siteIdOf(AttendanceLogic.requestId(ID)));
        assertNull(AttendanceLogic.siteIdOf(null));
        assertNull(AttendanceLogic.siteIdOf("other:" + ID));
        assertNull(AttendanceLogic.siteIdOf("dua:"));
        assertNull(AttendanceLogic.siteIdOf(ID));
    }

    @Test
    public void theFirstProblemIsReportedInTheOrderToFixThem() {
        assertNull(AttendanceLogic.problem(true, true, true, false));
        assertEquals("no_precise_location", AttendanceLogic.problem(false, false, false, true));
        assertEquals("location_off", AttendanceLogic.problem(true, false, false, true));
        assertEquals("no_background_location", AttendanceLogic.problem(true, false, true, true));
        assertEquals("background_restricted", AttendanceLogic.problem(true, true, true, true));
    }
}
